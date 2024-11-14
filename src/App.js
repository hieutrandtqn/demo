import logo from "./logo.svg";
import "./App.css";
import {
  ADB_DEFAULT_DEVICE_FILTER,
  AdbDaemonWebUsbDeviceManager,
} from "@yume-chan/adb-daemon-webusb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { AdbDaemonTransport } from "@yume-chan/adb";
import { Adb } from "@yume-chan/adb";
import React, { useRef, useState } from "react";
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
  CodecOptions,
  DEFAULT_SERVER_PATH,
  h264ParseConfiguration,
  h265ParseConfiguration,
  ScrcpyInstanceId,
  ScrcpyLogLevel,
  ScrcpyOptions1_24,
  ScrcpyOptions2_1,
  ScrcpyOptions2_3,
  ScrcpyOptionsLatest,
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
    // const { metadata, stream: videoPacketStream } = await videoStream;
    // console.log("Video metadata:", metadata);
    // console.log("Video metadata codec:", metadata.codec);

    // // // Set Width and Height
    // // width.value = metadata.width;
    // // height.value = metadata.height;

    // // Initialize the decoder
    // initializeDecoder(videoPacketStream, metadata);

    videoStream.then(({ stream, metadata }) => {
      console.log("Video metadata:", metadata);
      console.log("Video metadata codec:", metadata.codec);

      // // Set Width and Height
      // width.value = metadata.width;
      // height.value = metadata.height;

      // Initialize the decoder
      initializeDecoder(stream, metadata);
    });
  };

  const initializeDecoder = (stream, metadata) => {
    try {
      // Setting up the decoder
      decoder = new WebCodecsVideoDecoder(metadata.codec);

      document.body.appendChild(decoder.renderer);
      console.log("Adding a renderer to a container:", decoder.renderer);

      // Reset keyframe tracking
      lastKeyframe.current = 0n;

      // Processing video packets
      const handler = new InspectStream((packet) => {
        console.log("Processing packet:", packet);
        handlePacket(packet, metadata);
      });
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
    // width.value = croppedWidth;
    // height.value = croppedHeight;
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
      const adb = new Adb(transport);
      alert(device.name);
      setAdb(adb);

      // `undefined` if `video: false` option was specified
      // if (client.videoStream) {
      //   initializeVideoStream(client.videoStream);
      // }
      // if (client.videoStream) {
      //   const { metadata: videoMetadata, stream: videoPacketStream } =
      //     await client.videoStream;
      //   console.log(videoMetadata.codec);

      //   const decoder = new WebCodecsVideoDecoder();
      //   document.body.appendChild(decoder.renderer);

      //   // videoPacketStream
      //   //   .pipeTo(
      //   //     new WritableStream({
      //   //       write(packet) {
      //   //         switch (packet.type) {
      //   //           case "configuration":
      //   //             // Handle configuration packet
      //   //             console.log(packet.data);
      //   //             break;
      //   //           case "data":
      //   //             // Handle data packet
      //   //             console.log(packet.keyframe, packet.pts, packet.data);

      //   //             break;
      //   //         }
      //   //       },
      //   //     })
      //   //   )
      //   //   .catch((e) => {
      //   //     console.error(e);
      //   //   });

      //   videoPacketStream // from above
      //     .pipeTo(decoder.writable)
      //     .catch((e) => {
      //       console.error(e);
      //     });
      // }
    } catch (error) {
      // `usb` package for Node.js doesn't throw a real `DOMException`
      // This check is compatible with both Chrome and `usb` package
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "NetworkError"
      ) {
        alert(
          "The device is already in use by another program. Please close the program and try again."
        );
      }
      throw error;
    }
  };

  const disconnect = () => {
    currentDevice && currentDevice.close();
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
    // const options = new ScrcpyOptions1_24({
    //   // other options...
    //   codecOptions: new CodecOptions({
    //     profile: H264Capabilities.maxProfile,
    //     level: H264Capabilities.maxLevel,
    //   }),
    // });

    // const options = new AdbScrcpyOptions2_1(
    //   new ScrcpyOptions2_3({
    //     videoSource: "display",
    //     video: true,
    //     videoCodecOptions: new CodecOptions({
    //       ...DEFAULT_SETTINGS,
    //       // logLevel: ScrcpyLogLevel.Debug,
    //       // scid: ScrcpyInstanceId.random(),
    //       // sendDeviceMeta: true,
    //       // sendDummyByte: true,
    //     }),
    //   })
    // );
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

    const client = await AdbScrcpyClient.start(
      adb,
      DEFAULT_SERVER_PATH,
      // If server binary was downloaded manually, must provide the correct version
      VERSION,
      options
    );

    // Print output of Scrcpy server
    void client.stdout.pipeTo(
      new WritableStream({
        write(chunk) {
          console.log(chunk);
        },
      })
    );

    client.videoStream.then(({ stream, metadata }) => {
      const decoder = new TinyH264Decoder();

      document.body.appendChild(decoder.renderer);

      let lastKeyframe = 0n;
      const handler = new InspectStream((packet) => {
        console.log("Processing packet:", packet);
        if (packet.type === "configuration") {
          let croppedWidth;
          let croppedHeight;
          switch (metadata.codec) {
            case ScrcpyVideoCodecId.H264:
              ({ croppedWidth, croppedHeight } = h264ParseConfiguration(
                packet.data
              ));
              break;
            case ScrcpyVideoCodecId.H265:
              ({ croppedWidth, croppedHeight } = h265ParseConfiguration(
                packet.data
              ));
              break;
            default:
              throw new Error("Codec not supported");
          }
        } else if (packet.keyframe && packet.pts !== undefined) {
          if (lastKeyframe) {
            const interval = (Number(packet.pts - lastKeyframe) / 1000) | 0;
          }
          lastKeyframe = packet.pts;
        }
      });

      stream.pipeThrough(handler).pipeTo(decoder.writable);
      // stream.pipeTo(
      //   new WritableStream({
      //     write(packet) {
      //       console.log("Packet processed:", packet);
      //     },
      //   })
      // );
    });
  };

  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          Edit <code>src/App.js</code> and save to reload.
        </p>
        <button onClick={requestPermission}>Request permission</button>
        <button onClick={connectToDevice}>Connect to device</button>
        <button onClick={disconnect}>Disconnect</button>
        <button onClick={handleScreenCast}>Screen cast</button>
      </header>
    </div>
  );
}

export default App;
