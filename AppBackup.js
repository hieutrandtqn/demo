import logo from "./logo.svg";
import "./App.css";
import {
  ADB_DEFAULT_DEVICE_FILTER,
  AdbDaemonWebUsbDeviceManager,
} from "@yume-chan/adb-daemon-webusb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { AdbDaemonTransport } from "@yume-chan/adb";
import { Adb } from "@yume-chan/adb";
import React from "react";
import { ReadableStream } from "@yume-chan/stream-extra";
import { BIN, VERSION } from "@yume-chan/fetch-scrcpy-server";
import { AdbScrcpyClient, AdbScrcpyOptions2_1 } from "@yume-chan/adb-scrcpy";
import {
  CodecOptions,
  DEFAULT_SERVER_PATH,
  ScrcpyOptions2_1,
} from "@yume-chan/scrcpy";
import { WebCodecsVideoDecoder } from "@yume-chan/scrcpy-decoder-webcodecs";
import { TinyH264Decoder } from "@yume-chan/scrcpy-decoder-tinyh264";

function App() {
  const Manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  const CredentialStore = new AdbWebCredentialStore("demo-web-adb");

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

  const connectToDevice = async () => {
    const devices = await Manager.getDevices();
    if (!devices.length) {
      alert("No device connected");
      return;
    }
    const device = devices[0];
    try {
      const connection = await device.connect();
      const transport = await AdbDaemonTransport.authenticate({
        serial: device.serial,
        connection,
        credentialStore: CredentialStore,
      });
      const adb = new Adb(transport);
      alert(device.name);

      //Scrcpy
      console.log(VERSION); // 2.1
      const server = await fetch(BIN).then((res) => res.arrayBuffer());
      await AdbScrcpyClient.pushServer(
        adb,
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(server));
            controller.close();
          },
        })
      );

      const H264Capabilities = TinyH264Decoder.capabilities.h264;
      const options = new AdbScrcpyOptions2_1(
        new ScrcpyOptions2_1({
          // options
          video: true,
          codecOptions: new CodecOptions({
            profile: H264Capabilities.maxProfile,
            level: H264Capabilities.maxLevel,
          }),
        })
        // {
        //   // other options...
        //   codecOptions: new CodecOptions({
        //     profile: H264Capabilities.maxProfile,
        //     level: H264Capabilities.maxLevel,
        //   }),
        // }
      );

      const client = await AdbScrcpyClient.start(
        adb,
        DEFAULT_SERVER_PATH,
        // If server binary was downloaded manually, must provide the correct version
        VERSION,
        options
      );

      // `undefined` if `video: false` option was given
      if (client.videoStream) {
        const { metadata: videoMetadata, stream: videoPacketStream } =
          await client.videoStream;

        const isSupported = window.VideoDecoder !== undefined;
        const result = await VideoDecoder.isConfigSupported({
          codec: "hev1.1.60.L153.B0.0.0.0.0.0",
        });
        const isHevcSupported = result.supported === true;

        // const decoder = new WebCodecsVideoDecoder();
        // document.body.appendChild(decoder.renderer);

        // videoPacketStream // from above
        //   .pipeTo(decoder.writable)
        //   .catch((e) => {
        //     console.log(e);
        //   });

        const decoder2 = new TinyH264Decoder();
        document.body.appendChild(decoder2.renderer);

        // Get the writer once before starting the async loop
        const writer = decoder2.writable.getWriter();

        // Process the video packet stream in a continuous async loop
        const reader = videoPacketStream.getReader();
        async function processStream() {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              console.log("Stream ended.");
              break;
            }
            try {
              await writer.write(value); // Write using the single writer
            } catch (error) {
              console.error("Decoding error:", error);
              break;
            }
          }
          writer.releaseLock(); // Release lock once done
        }
        processStream().catch((error) => {
          console.log(error);
        });

        // videoPacketStream
        //   .getReader()
        //   .read()
        //   .then(({ done, value }) => {
        //     console.log("Received video packet:", value);
        //     if (done) {
        //       console.log("Stream ended.");
        //     }
        //   });

        // videoPacketStream // from above
        //   .pipeTo(decoder2.writable)
        //   .catch((error) => console.error("Streaming error:", error));

        // const reader = videoPacketStream.getReader();
        // async function processStream() {
        //   while (true) {
        //     const { done, value } = await reader.read();
        //     if (done) break;
        //     await decoder2.writable.getWriter().write(value);
        //   }
        // }
        // processStream().catch(console.error);
      }

      // `undefined` if `audio: false` option was given
      if (client.audioStream) {
        const metadata = await client.audioStream;
        switch (metadata.type) {
          case "disabled":
            // Audio not supported by device
            break;
          case "errored":
            // Other error when initializing audio
            break;
          case "success":
            // Audio packets in the codec specified in options
            const audioPacketStream = metadata.stream;
            break;
        }
      }

      // `undefined` if `control: false` option was given
      const controller = client.controller;
      const clipboardStream = options.clipboard;

      clipboardStream
        .pipeTo(
          new WritableStream({
            write(chunk) {
              // Handle device clipboard change
              console.log(chunk);
            },
          })
        )
        .catch((error) => {
          console.error(error);
        });
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

  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          Edit <code>src/App.js</code> and save to reload.
        </p>
        <button onClick={requestPermission}>Request permission</button>
        <button onClick={connectToDevice}>Connect to device</button>
      </header>
    </div>
  );
}

export default App;
