import logo from "./logo.svg";
// import "./App.css";
import {
  ADB_DEFAULT_DEVICE_FILTER,
  AdbDaemonWebUsbDeviceManager,
  AdbDaemonWebUsbDeviceWatcher,
} from "@yume-chan/adb-daemon-webusb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { AdbDaemonTransport } from "@yume-chan/adb";
import { Adb } from "@yume-chan/adb";
import React, { useEffect, useRef, useState } from "react";
import {
  Consumable,
  DistributionStream,
  InspectStream,
  ReadableStream,
} from "@yume-chan/stream-extra";
import { BIN, VERSION } from "@yume-chan/fetch-scrcpy-server";
import {
  AdbScrcpyClient,
  AdbScrcpyOptions2_1,
  AdbScrcpyOptionsLatest,
} from "@yume-chan/adb-scrcpy";
import {
  AndroidMotionEventAction,
  AndroidMotionEventButton,
  clamp,
  CodecOptions,
  DEFAULT_SERVER_PATH,
  h264ParseConfiguration,
  h265ParseConfiguration,
  ScrcpyHoverHelper,
  ScrcpyInstanceId,
  ScrcpyLogLevel,
  ScrcpyOptions1_24,
  ScrcpyOptions2_1,
  ScrcpyOptions2_3,
  ScrcpyOptionsLatest,
  ScrcpyPointerId,
  ScrcpyVideoCodecId,
  ScrcpyVideoOrientation,
} from "@yume-chan/scrcpy";
import { WebCodecsVideoDecoder } from "@yume-chan/scrcpy-decoder-webcodecs";
import { TinyH264Decoder } from "@yume-chan/scrcpy-decoder-tinyh264";

export const DEFAULT_SETTINGS = {
  maxSize: 1080,
  videoBitRate: 8000000,
  videoCodec: "h264",
  lockVideoOrientation: ScrcpyVideoOrientation.Unlocked,
  displayId: 0,
  crop: "",
  powerOn: true,
  audio: false,
  audioCodec: "aac",
};

export const SCRCPY_SETTINGS_FILENAME = "/data/local/tmp/.tango.json";
export const ADB_SYNC_MAX_PACKET_SIZE = 64 * 1024;

function App() {
  const Manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  const CredentialStore = new AdbWebCredentialStore("demo-web-adb");
  const [currentDevice, setCurrentDevice] = useState();
  const [adb, setAdb] = useState();
  const lastKeyframe = useRef(0n);
  let decoder;

  let options;
  let client = useRef(null);
  let rotation = 0;
  let hoverHelper = useRef(null);
  let videoStream;
  let aspectRatio;
  const width = useRef(0);
  const height = useRef(0);
  // const {height: windowHeight, width: windowWidth} = useWindowResize();
  const deviceFrame = useRef();
  const openInput = useRef(false);
  // 旋转角度常量
  const ROTATION_90 = 1;
  const ROTATION_180 = 2;
  const ROTATION_270 = 3;
  /**
   * 将鼠标事件按钮映射到 Android 按钮
   */
  const MOUSE_EVENT_BUTTON_TO_ANDROID_BUTTON = [
    AndroidMotionEventButton.Primary,
    AndroidMotionEventButton.Tertiary,
    AndroidMotionEventButton.Secondary,
    AndroidMotionEventButton.Back,
    AndroidMotionEventButton.Forward,
  ];

  useEffect(() => {
    async function handleDeviceChange(addedDeviceSerial) {
      if (addedDeviceSerial) {
        // A device with serial `addedDeviceSerial` is added
        connectToDevice();
        alert("connectToDevice()");
        console.log("connectToDevice()");
      } else {
        // A device is removed

        //Alway close adb
        if (adb) {
          await adb.close();
          await destroyClient();
          setAdb(undefined);
        }
        alert("destroyClient()");
        console.log("destroyClient()");
      }
    }

    const watcher = new AdbDaemonWebUsbDeviceWatcher(
      handleDeviceChange,
      navigator.usb
    );

    // Stop watching devices

    return () => {
      destroyClient();
      watcher.dispose();

      deviceFrame.current.addEventListener("pointerdown", handlePointerDown);
      deviceFrame.current.addEventListener("pointermove", handlePointerMove);
      deviceFrame.current.addEventListener("pointerup", handlePointerUp);
      deviceFrame.current.addEventListener("pointercancel", handlePointerUp);
      deviceFrame.current.addEventListener("pointerleave", handlePointerLeave);
      deviceFrame.current.addEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  useEffect(() => {
    adb && handleScreenCast();
  }, [adb]);

  if (!Manager) {
    alert("WebUSB is not supported in this browser");
    return;
  }

  const requestPermission = async () => {
    const device = await Manager.requestDevice();
    if (!device) {
      alert("No device selected");
      return;
    }
  };

  const initializeVideoStream = async (videoStream) => {
    const { metadata, stream: videoPacketStream } = await videoStream;
    console.log("Video metadata:", metadata);
    console.log("Video metadata codec:", metadata.codec);

    // Initialize the decoder
    initializeDecoder(videoPacketStream, metadata);
  };

  const initializeDecoder = (stream, metadata) => {
    try {
      // Setting up the decoder
      decoder = new WebCodecsVideoDecoder(metadata.codec);

      deviceFrame.current.appendChild(decoder.renderer);
      console.log("Adding a renderer to a container:", decoder.renderer);

      // Reset keyframe tracking
      lastKeyframe.current = 0n;

      // Processing video packets
      const handler = new InspectStream((packet) => {
        handlePacket(packet, metadata);
      });

      handleWheelTest();

      stream.pipeThrough(handler).pipeTo(decoder.writable);

      // Connecting to video stream
      if (stream && typeof stream.pipeTo === "function") {
        // videoPacketStream.pipeThrough(handler).pipeTo(decoder.writable);
        // .then((r) => console.log("pipeTo", r))
        // .catch((e) => console.log("pipe error:", e));
        console.log("The video stream is connected to the decoder");
      } else {
        console.error("videoPacketStream is invalid or unavailable");
      }
    } catch (error) {
      console.error("Error initializing decoder:", error);
    }
  };

  const handlePacket = (packet, metadata) => {
    if (packet.type === "configuration") {
      handleConfiguration(packet.data, metadata);
    } else if (packet.keyframe && packet.pts !== undefined) {
      handleKeyframe(packet);
    }
  };

  const handleConfiguration = (data, metadata) => {
    let croppedWidth, croppedHeight;
    // 根据编码类型解析宽高
    switch (metadata.codec) {
      case ScrcpyVideoCodecId.H264:
        ({ croppedWidth, croppedHeight } = h264ParseConfiguration(data));
        break;
      case ScrcpyVideoCodecId.H265:
        ({ croppedWidth, croppedHeight } = h265ParseConfiguration(data));
        break;
      default:
        throw new Error("Unsupported codec");
    }
    console.log(`[client] 视频尺寸变化: ${croppedWidth}x${croppedHeight}`);
    // 更新宽高并调整样式
    width.current = croppedWidth;
    height.current = croppedHeight;

    deviceFrame.current.style.width = croppedWidth;
    deviceFrame.current.style.height = croppedHeight;

    // changeStyle();
  };

  const handleKeyframe = (packet) => {
    if (lastKeyframe.current) {
      const interval = Math.floor(
        Number(packet.pts - lastKeyframe.current) / 1000
      );
      console.log(`[client] Keyframe Interval: ${interval}ms`);
    }
    console.log(packet.keyframe, packet.pts, packet.data);
    lastKeyframe.current = packet.pts;
  };

  const connectToDevice = async () => {
    const devices = await Manager.getDevices();
    if (!devices.length) {
      alert("No device connected");
      return;
    }
    const device = devices[0];
    setCurrentDevice(device);
    try {
      const connection = await device.connect();
      const transport = await AdbDaemonTransport.authenticate({
        serial: device.serial,
        connection,
        credentialStore: CredentialStore,
      });

      const newAdb = new Adb(transport);
      alert(device.serial);
      setAdb(newAdb);
    } catch (e) {
      console.error(e);
    }
  };

  const disconnect = async () => {
    const container = deviceFrame.current;
    if (container) {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("contextmenu", handleContextMenu);
      container.removeEventListener("keydown", handleKeyCode);
      container.removeEventListener("keyup", handleKeyCode);
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerup", handlePointerUp);
      container.removeEventListener("pointerleave", handlePointerLeave);
    }
    if (client.current) {
      await client.current.close();
    }
    // if (adb) {
    //   await adb.close();
    //   setAdb(undefined);
    // }
    if (decoder) {
      if (decoder.renderer && container) {
        container.removeChild(decoder.renderer);
      }
      decoder = null;
    }
  };

  const handleScreenCast = async () => {
    //Scrcpy
    console.log("VERSION=" + VERSION);
    const server = await fetch(BIN).then((res) => res.arrayBuffer());
    await AdbScrcpyClient.pushServer(
      adb,
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Consumable(new Uint8Array(server)));
          controller.close();
        },
      })
    );

    const H264Capabilities = TinyH264Decoder.capabilities.h264;

    const videoCodecOptions = new CodecOptions({
      profile: H264Capabilities.maxProfile,
      level: H264Capabilities.maxLevel,
    });
    const options = new AdbScrcpyOptionsLatest(
      new ScrcpyOptionsLatest({
        ...DEFAULT_SETTINGS,
        logLevel: ScrcpyLogLevel.Debug,
        scid: ScrcpyInstanceId.random(),
        sendDeviceMeta: false,
        sendDummyByte: false,
        videoCodecOptions,
      })
    );

    hoverHelper.current = new ScrcpyHoverHelper();

    client.current = await AdbScrcpyClient.start(
      adb,
      DEFAULT_SERVER_PATH,
      // If server binary was downloaded manually, must provide the correct version
      VERSION,
      options
    );

    // Print output of Scrcpy server
    client.current.stdout.pipeTo(
      new WritableStream({
        write(chunk) {
          console.log(chunk);
        },
      })
    );

    videoStream = await client.current.videoStream;

    if (videoStream) {
      initializeVideoStream(videoStream);
    }
  };

  //Controller
  const clientPositionToDevicePosition = (clientX, clientY) => {
    if (!deviceFrame.current) {
      return { x: 0, y: 0 }; // 如果渲染容器不存在，返回默认坐标
    }

    const viewRect = deviceFrame.current.getBoundingClientRect();
    const pointerViewX = clamp((clientX - viewRect.x) / viewRect.width, 0, 1);
    const pointerViewY = clamp((clientY - viewRect.y) / viewRect.height, 0, 1);

    // 根据旋转调整坐标
    const adjustedPosition = adjustPositionForRotation(
      pointerViewX,
      pointerViewY,
      rotation
    );

    return {
      x: adjustedPosition.x * width.current,
      y: adjustedPosition.y * height.current,
    };
  };

  const adjustPositionForRotation = (pointerViewX, pointerViewY, rotation) => {
    let adjustedX = pointerViewX;
    let adjustedY = pointerViewY;

    // 处理坐标旋转
    switch (rotation) {
      case ROTATION_90:
        [adjustedX, adjustedY] = [adjustedY, adjustedX]; // 90度旋转
        adjustedY = 1 - adjustedY; // 反转 Y 坐标
        break;
      case ROTATION_180:
        adjustedX = 1 - adjustedX; // 180度旋转，反转 X 坐标
        adjustedY = 1 - adjustedY; // 反转 Y 坐标
        break;
      case ROTATION_270:
        [adjustedX, adjustedY] = [adjustedY, adjustedX]; // 270度旋转
        adjustedX = 1 - adjustedX; // 反转 X 坐标
        break;
    }

    return { x: adjustedX, y: adjustedY };
  };

  const handleWheelTest = () => {
    deviceFrame.current.addEventListener("wheel", handleWheel, {
      passive: false,
    });
  };

  /**
   * 防止事件的默认行为和传播
   * @param {Event} event 事件对象
   */
  const preventEventDefaults = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  /**
   * 处理滚轮事件
   * @param {WheelEvent} event 滚轮事件
   */
  const handleWheel = async (event) => {
    preventEventDefaults(event); // 预防默认事件行为

    const { x, y } = clientPositionToDevicePosition(
      event.clientX,
      event.clientY
    );
    await client.current.controller.injectScroll({
      pointerX: x,
      pointerY: y,
      screenWidth: width.current,
      screenHeight: height.current,
      scrollX: -event.deltaX / 100,
      scrollY: -event.deltaY / 100,
      buttons: 0,
    });
  };

  const injectTouch = async (action, event) => {
    const pointerId =
      event.pointerType === "mouse"
        ? ScrcpyPointerId.Finger // Android 13 has bug with mouse injection
        : BigInt(event.pointerId);

    const { x, y } = clientPositionToDevicePosition(
      event.clientX,
      event.clientY
    );

    const messages = hoverHelper.current.process({
      action,
      pointerId,
      screenWidth: width.current,
      screenHeight: height.current,
      pointerX: x,
      pointerY: y,
      pressure: event.pressure,
      actionButton: MOUSE_EVENT_BUTTON_TO_ANDROID_BUTTON[event.button],
      buttons: event.buttons,
    });

    for (const message of messages) {
      await client.current.controller.injectTouch(message);
    }
  };

  const handlePointerDown = async (event) => {
    preventEventDefaults(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    await injectTouch(AndroidMotionEventAction.Down, event);
  };

  const handlePointerMove = async (event) => {
    preventEventDefaults(event);
    const action =
      event.buttons === 0
        ? AndroidMotionEventAction.HoverMove
        : AndroidMotionEventAction.Move;
    await injectTouch(action, event);
  };

  const handlePointerUp = async (event) => {
    preventEventDefaults(event);
    await injectTouch(AndroidMotionEventAction.Up, event);
  };

  const handlePointerLeave = async (event) => {
    preventEventDefaults(event);
    await injectTouch(AndroidMotionEventAction.HoverExit, event);
    await injectTouch(AndroidMotionEventAction.Up, event);
  };

  const handleContextMenu = (event) => {
    preventEventDefaults(event);
  };

  const handleKeyCode = async (e, code = null) => {
    if (code) {
      await client.current.controller.injectKeyCode({
        action:
          e.type === "mousedown"
            ? AndroidKeyEventAction.Down
            : AndroidKeyEventAction.Up,
        keyCode: code,
        repeat: 0,
        metaState: AndroidKeyEventMeta.NumLockOn,
      });
    } else {
      const keyCode = AndroidKeyCode[e.code];
      if (keyCode) {
        await client.current.controller.injectKeyCode({
          action:
            e.type === "keydown"
              ? AndroidKeyEventAction.Down
              : AndroidKeyEventAction.Up,
          keyCode,
          repeat: 0,
          metaState: AndroidKeyEventMeta.NumLockOn,
        });
      }
    }
  };

  const destroyClient = async () => {
    const container = deviceFrame.current;
    if (container) {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("contextmenu", handleContextMenu);
      container.removeEventListener("keydown", handleKeyCode);
      container.removeEventListener("keyup", handleKeyCode);
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerup", handlePointerUp);
      container.removeEventListener("pointerleave", handlePointerLeave);
    }

    if (client.current) {
      await client.current.close();
    }

    // if (adb) {
    //   await adb.close();
    //   adb = null;
    // }

    if (decoder) {
      if (decoder.renderer && container) {
        container.removeChild(decoder.renderer);
      }
      decoder = null;
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <div ref={deviceFrame} className="deviceFrame"></div>
        {/* <img src={logo} className="App-logo" alt="logo" /> */}
        {/* <p>
          Edit <code>src/App.js</code> and save to reload.
        </p> */}
        <button onClick={requestPermission}>Request permission</button>
        <button onClick={connectToDevice}>Connect to device</button>
        <button onClick={disconnect}>Disconnect</button>
        <button onClick={handleScreenCast}>Screen cast</button>
      </header>
    </div>
  );
}

export default App;
