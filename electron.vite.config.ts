import { defineConfig } from "electron-vite";
import * as path from "path";

export default defineConfig({
    main: {},
    renderer: {
        build: {
            rollupOptions: {
                input: {
                    editor: path.resolve(__dirname, "src/renderer/editor.html"),
                    clip: path.resolve(__dirname, "src/renderer/capture.html"),
                    setting: path.resolve(__dirname, "src/renderer/setting.html"),
                    help: path.resolve(__dirname, "src/renderer/help.html"),
                    ding: path.resolve(__dirname, "src/renderer/ding.html"),
                    recorder: path.resolve(__dirname, "src/renderer/recorder.html"),
                    recorderTip: path.resolve(__dirname, "src/renderer/recorderTip.html"),
                    browser_bg: path.resolve(__dirname, "src/renderer/browser_bg.html"),
                    translator: path.resolve(__dirname, "src/renderer/translator.html"),
                },
            },
        },
    },
});
