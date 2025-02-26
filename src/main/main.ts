/// <reference types="vite/client" />
// Modules to control application life and create native browser window
import {
    app,
    Tray,
    Menu,
    clipboard,
    globalShortcut,
    BrowserWindow,
    ipcMain,
    dialog,
    Notification,
    shell,
    nativeImage,
    nativeTheme,
    BrowserView,
    screen,
    desktopCapturer,
    session,
    crashReporter,
} from "electron";
import { Buffer } from "buffer";

const Store = require("electron-store");
import { setting, MainWinType, translateWinType } from "../ShareTypes";
import * as path from "path";
const runPath = path.join(path.resolve(__dirname, ""), "../../");
import { exec } from "child_process";
import * as fs from "fs";
import * as os from "os";
import { t, lan } from "../../lib/translate/translate";
import time_format from "../../lib/time_format";
import url from "node:url";

// 自定义用户路径
try {
    var userDataPath = fs.readFileSync(path.join(runPath, "preload_config")).toString().trim();
    if (userDataPath) {
        if (app.isPackaged) {
            userDataPath = path.join(runPath, "../../", userDataPath);
        } else {
            userDataPath = path.join(runPath, userDataPath);
        }
        app.setPath("userData", userDataPath);
    }
} catch (e) {}

// 获取运行位置
ipcMain.on("run_path", (event) => {
    event.returnValue = runPath;
});

try {
    var store = new Store();
} catch (error) {
    fs.unlinkSync(path.join(app.getPath("userData"), "config.json"));
    var store = new Store();
}

var /** 是否开启开发模式 */ dev: boolean;
// 自动开启开发者模式
if (process.argv.includes("-d") || import.meta.env.DEV) {
    dev = true;
} else {
    dev = false;
}

function mainUrl(fileName: string) {
    if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
        let mainUrl = `${process.env["ELECTRON_RENDERER_URL"]}/${fileName}`;
        return mainUrl;
    } else {
        return path.join(__dirname, "../renderer", fileName);
    }
}

/** 加载网页 */
function rendererPath(window: BrowserWindow, fileName: string) {
    const q = { query: { config_path: app.getPath("userData") } };
    if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
        let x = new url.URL(mainUrl(fileName));
        for (let i in q.query) {
            x.searchParams.set(i, q.query[i]);
        }
        window.loadURL(x.toString());
    } else {
        window.loadFile(mainUrl(fileName), q);
    }
    window.webContents.on("will-navigate", (event) => {
        event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(() => {
        return { action: "deny" };
    });
}
function rendererPath2(window: Electron.WebContents, fileName: string, q?: Electron.LoadFileOptions) {
    if (!q) {
        q = { query: { config_path: app.getPath("userData") } };
    } else if (!q.query) {
        q.query = { config_path: app.getPath("userData") };
    } else {
        q.query["config_path"] = app.getPath("userData");
    }
    if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
        let x = new url.URL(mainUrl(fileName));
        if (q) {
            if (q.search) x.search = q.search;
            if (q.query) {
                for (let i in q.query) {
                    x.searchParams.set(i, q.query[i]);
                }
            }
            if (q.hash) x.hash = q.hash;
        }
        window.loadURL(x.toString());
    } else {
        window.loadFile(mainUrl(fileName), q);
    }
}

if (!store.get("硬件加速")) {
    app.disableHardwareAcceleration();
}

// 自启动
ipcMain.on("autostart", (event, m, v) => {
    if (m == "set") {
        if (process.platform == "linux") {
            if (v) {
                exec("mkdir ~/.config/autostart");
                exec(`cp ${runPath}/assets/e-search.desktop ~/.config/autostart/`);
            } else {
                exec("rm ~/.config/autostart/e-search.desktop");
            }
        } else {
            app.setLoginItemSettings({ openAtLogin: v });
        }
    } else {
        if (process.platform == "linux") {
            exec("test -e ~/.config/autostart/e-search.desktop", (error, _stdout, _stderr) => {
                error ? event.sender.send("开机启动状态", false) : event.sender.send("开机启动状态", true);
            });
        } else {
            event.sender.send("开机启动状态", app.getLoginItemSettings().openAtLogin);
        }
    }
});

/**
 * 复制选区，存在变化，回调
 */
async function copyText(callback: (t: string) => void) {
    var oClipboard = clipboard.readText();
    if (process.platform == "darwin") {
        exec(
            `osascript -e 'tell application "System Events"' -e 'delay 0.1' -e 'key code 8 using command down' -e 'end tell'`
        );
    } else if (process.platform == "win32") {
        exec(`"${path.join(runPath, "lib/copy.exe")}"`);
    } else if (process.platform == "linux") {
        exec(store.get("主搜索功能.linux_copy") || "xdotool key ctrl+c");
    }
    setTimeout(() => {
        let t = clipboard.readText();
        let v = "";
        if (oClipboard != t) v = t;
        for (let i of store.get("主搜索功能.自动搜索排除")) {
            if (t.match(i)) {
                v = "";
                break;
            }
        }
        callback(v);
        clipboard.writeText(oClipboard);
    }, 300);
}

/** 自动判断选中搜索还是截屏搜索 */
function autoOpen() {
    copyText((t) => {
        if (t) {
            createMainWindow({ type: "text", content: t });
        } else {
            fullScreen();
        }
    });
}

/** 选区搜索 */
function openSelection() {
    copyText((t) => {
        if (t) createMainWindow({ type: "text", content: t });
    });
}

/** 剪贴板搜索 */
function openClipBoard() {
    var t = clipboard.readText(
        process.platform == "linux" && store.get("主搜索功能.剪贴板选区搜索") ? "selection" : "clipboard"
    );
    createMainWindow({ type: "text", content: t });
}

// cli参数重复启动;
var firstOpen = true;
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) {
    firstOpen = false;
    app.quit();
} else {
    app.on("second-instance", (_event, commanLine, _workingDirectory) => {
        argRun(commanLine);
    });
}

/**
 * 根据命令运行
 * @param {string[]} c 命令
 */
function argRun(c: string[]) {
    if (c.includes("-d")) dev = true;
    switch (true) {
        case c.includes("-a"):
            autoOpen();
            break;
        case c.includes("-c"):
            fullScreen();
            break;
        case c.includes("-s"):
            openSelection();
            break;
        case c.includes("-b"):
            openClipBoard();
            break;
        case c.includes("-g"):
            createMainWindow({ type: "text", content: "" });
            break;
        case c.includes("-q"):
            quickClip();
            break;
        case c.includes("-t"):
            createMainWindow({ type: "text", content: c[c.findIndex((t) => t === "-t") + 1] });
            break;
        default:
            for (let i of c) {
                if (i.match(/(\.png)|(\.jpg)|(\.svg)$/i)) {
                    fullScreen(i);
                    break;
                }
            }
            break;
    }
}

async function rmR(dir_path: string) {
    fs.rm(dir_path, { recursive: true }, (err) => {
        if (err) console.error(err);
    });
}

var contextMenu: Electron.Menu, tray: Tray;

app.commandLine.appendSwitch("enable-experimental-web-platform-features", "enable");

app.whenReady().then(() => {
    crashReporter.start({ uploadToServer: false });

    if (store.get("首次运行") === undefined) setDefaultSetting();
    fix_setting_tree();

    // 初始化语言
    lan(store.get("语言.语言"));

    // 初始化设置
    Store.initRenderer();
    // 托盘
    tray =
        process.platform == "linux"
            ? new Tray(`${runPath}/assets/logo/32x32.png`)
            : new Tray(`${runPath}/assets/logo/16x16.png`);
    contextMenu = Menu.buildFromTemplate([
        {
            label: `${t("自动识别")}`,
            click: () => {
                autoOpen();
            },
        },
        {
            label: t("截屏搜索"),
            click: () => {
                setTimeout(() => {
                    fullScreen();
                }, store.get("主搜索功能.截屏搜索延迟"));
            },
        },
        {
            label: t("选中搜索"),
            click: () => {
                openSelection();
            },
        },
        {
            label: t("剪贴板搜索"),
            click: () => {
                openClipBoard();
            },
        },
        {
            type: "separator",
        },
        {
            label: t("OCR(文字识别)"),
            click: () => {
                sendCaptureEvent(null, "ocr");
            },
        },
        {
            label: t("以图搜图"),
            click: () => {
                sendCaptureEvent(null, "image_search");
            },
        },
        {
            type: "separator",
        },
        {
            label: t("浏览器打开"),
            type: "checkbox",
            checked: store.get("浏览器中打开"),
            click: (i) => {
                store.set("浏览器中打开", i.checked);
            },
        },
        {
            type: "separator",
        },
        {
            label: t("主页面模式"),
            type: "submenu",
            submenu: [
                {
                    label: t("自动"),
                    type: "radio",
                    checked: store.get("主页面.模式") === "auto",
                    click: () => store.set("主页面.模式", "auto"),
                },
                {
                    label: t("搜索"),
                    type: "radio",
                    checked: store.get("主页面.模式") === "search",
                    click: () => store.set("主页面.模式", "search"),
                },
                {
                    label: t("翻译"),
                    type: "radio",
                    checked: store.get("主页面.模式") === "translate",
                    click: () => store.set("主页面.模式", "translate"),
                },
            ],
        },
        { type: "separator" },
        {
            label: t("主页面"),
            click: () => {
                createMainWindow({ type: "text", content: "" });
            },
        },
        {
            label: t("设置"),
            click: () => {
                Store.initRenderer();
                createSettingWindow();
            },
        },
        {
            label: t("教程帮助"),
            click: () => {
                createHelpWindow();
            },
        },
        {
            type: "separator",
        },
        {
            label: t("重启"),
            click: () => {
                app.relaunch();
                app.exit(0);
            },
        },
        {
            label: t("退出"),
            click: () => {
                app.quit();
            },
        },
    ]);
    if (store.get("点击托盘自动截图")) {
        tray.on("click", () => {
            fullScreen();
        });
        tray.on("right-click", () => {
            tray.popUpContextMenu(contextMenu);
        });
    } else {
        tray.setContextMenu(contextMenu);
    }

    // 启动时提示
    if (firstOpen && store.get("启动提示"))
        new Notification({
            title: app.name,
            body: `${app.name} ${t("已经在后台启动")}`,
            icon: `${runPath}/assets/logo/64x64.png`,
        }).show();

    // 快捷键
    const 快捷键函数 = {
        自动识别: autoOpen,
        截屏搜索: fullScreen,
        选中搜索: openSelection,
        剪贴板搜索: openClipBoard,
        快速截屏: quickClip,
        主页面: createMainWindow.bind(this, [""]),
    };
    ipcMain.on("快捷键", (event, arg) => {
        var [name, key] = arg;
        try {
            try {
                globalShortcut.unregister(store.get(`快捷键.${name}.key`));
            } catch {}
            let ok = false;
            if (key) {
                ok = globalShortcut.register(key, () => {
                    快捷键函数[arg[0]]();
                });
            }
            // key为空或成功注册时保存，否则存为空
            store.set(`快捷键.${name}.key`, key === "" || ok ? key : "");
            event.sender.send("状态", name, key ? ok : true);
        } catch (error) {
            event.sender.send("状态", name, false);
            store.set(`快捷键.${name}.key`, "");
        }
    });

    var /**@type {Object} */ 快捷键: object = store.get("快捷键");
    for (let k in 快捷键) {
        var m = 快捷键[k];
        try {
            if (m.key)
                globalShortcut.register(m.key, () => {
                    快捷键函数[k]();
                });
        } catch (error) {
            delete 快捷键[k].key;
            store.set(`快捷键`, 快捷键);
        }
    }

    // tmp目录
    if (!fs.existsSync(os.tmpdir() + "/eSearch")) fs.mkdir(os.tmpdir() + "/eSearch", () => {});
    createClipWindow();

    nativeTheme.themeSource = store.get("全局.深色模式");

    // 菜单栏设置
    const template = [
        // { role: 'appMenu' }
        ...(isMac
            ? [
                  {
                      label: app.name,
                      submenu: [
                          { label: `${t("关于")} ${app.name}`, role: "about" },
                          { type: "separator" },
                          {
                              label: t("设置"),
                              click: () => {
                                  createSettingWindow();
                              },
                              accelerator: "CmdOrCtrl+,",
                          },
                          { type: "separator" },
                          { label: t("服务"), role: "services" },
                          { type: "separator" },
                          { label: `${t("隐藏")} ${app.name}`, role: "hide" },
                          { label: t("隐藏其他"), role: "hideOthers" },
                          { label: t("全部显示"), role: "unhide" },
                          { type: "separator" },
                          { label: `退出 ${app.name}`, role: "quit" },
                      ],
                  },
              ]
            : []),
        // { role: 'fileMenu' }
        {
            label: t("文件"),
            submenu: [
                {
                    label: t("保存到历史记录"),
                    click: (_i, w) => {
                        mainEdit(w, "save");
                    },
                    accelerator: "CmdOrCtrl+S",
                },
                { type: "separator" },
                ...(isMac
                    ? []
                    : [
                          {
                              label: t("设置"),
                              click: () => {
                                  createSettingWindow();
                              },
                              accelerator: "CmdOrCtrl+,",
                          },
                          { type: "separator" },
                      ]),
                {
                    label: t("其他编辑器打开"),
                    click: (_i, w) => {
                        mainEdit(w, "edit_on_other");
                    },
                },
                {
                    label: t("打开方式..."),
                    click: (_i, w) => {
                        mainEdit(w, "choose_editer");
                    },
                },
                { type: "separator" },
                { label: t("关闭"), role: "close" },
            ],
        },
        // { role: 'editMenu' }
        {
            label: t("编辑"),
            submenu: [
                {
                    label: t("打开链接"),
                    click: (_i, w) => {
                        mainEdit(w, "link");
                    },
                    accelerator: "CmdOrCtrl+Shift+L",
                },
                {
                    label: t("搜索"),
                    click: (_i, w) => {
                        mainEdit(w, "search");
                    },
                    accelerator: "CmdOrCtrl+Shift+S",
                },
                {
                    label: t("翻译"),
                    click: (_i, w) => {
                        mainEdit(w, "translate");
                    },
                    accelerator: "CmdOrCtrl+Shift+T",
                },
                { type: "separator" },
                {
                    label: t("撤销"),
                    click: (_i, w) => {
                        mainEdit(w, "undo");
                        w.webContents.undo();
                    },
                    accelerator: "CmdOrCtrl+Z",
                },
                {
                    label: t("重做"),
                    click: (_i, w) => {
                        mainEdit(w, "redo");
                        w.webContents.redo();
                    },
                    accelerator: isMac ? "Cmd+Shift+Z" : "Ctrl+Y",
                },
                { type: "separator" },
                {
                    label: t("剪切"),
                    click: (_i, w) => {
                        mainEdit(w, "cut");
                        w.webContents.cut();
                    },
                    accelerator: "CmdOrCtrl+X",
                },
                {
                    label: t("复制"),
                    click: (_i, w) => {
                        mainEdit(w, "copy");
                        w.webContents.copy();
                    },
                    accelerator: "CmdOrCtrl+C",
                },
                {
                    label: t("粘贴"),
                    click: (_i, w) => {
                        mainEdit(w, "paste");
                        w.webContents.paste();
                    },
                    accelerator: "CmdOrCtrl+V",
                },
                {
                    label: t("删除"),
                    click: (_i, w) => {
                        mainEdit(w, "delete");
                        w.webContents.delete();
                    },
                },
                {
                    label: t("全选"),
                    click: (_i, w) => {
                        mainEdit(w, "select_all");
                        w.webContents.selectAll();
                    },
                    accelerator: "CmdOrCtrl+A",
                },
                {
                    label: t("自动删除换行"),
                    click: (_i, w) => {
                        mainEdit(w, "delete_enter");
                    },
                },
                { type: "separator" },
                {
                    label: t("查找"),
                    click: (_i, w) => {
                        mainEdit(w, "show_find");
                    },
                    accelerator: "CmdOrCtrl+F",
                },
                {
                    label: t("替换"),
                    click: (_i, w) => {
                        mainEdit(w, "show_find");
                    },
                    accelerator: isMac ? "CmdOrCtrl+Option+F" : "CmdOrCtrl+H",
                },
                { type: "separator" },
                {
                    label: t("自动换行"),
                    click: (_i, w) => {
                        mainEdit(w, "wrap");
                    },
                },
                {
                    label: t("拼写检查"),
                    click: (_i, w) => {
                        mainEdit(w, "spellcheck");
                    },
                },
                { type: "separator" },
                ...(isMac
                    ? [
                          {
                              label: t("朗读"),
                              submenu: [
                                  { label: t("开始朗读"), role: "startSpeaking" },
                                  { label: t("停止朗读"), role: "stopSpeaking" },
                              ],
                          },
                      ]
                    : []),
            ],
        },
        {
            label: t("浏览器"),
            submenu: [
                {
                    label: t("后退"),
                    click: (_i, w) => {
                        viewEvents(w, "back");
                    },
                    accelerator: isMac ? "Command+[" : "Alt+Left",
                },
                {
                    label: t("前进"),
                    click: (_i, w) => {
                        viewEvents(w, "forward");
                    },
                    accelerator: isMac ? "Command+]" : "Alt+Right",
                },
                {
                    label: t("刷新"),
                    click: (_i, w) => {
                        viewEvents(w, "reload");
                    },
                    accelerator: "F5",
                },
                {
                    label: t("停止加载"),
                    click: (_i, w) => {
                        viewEvents(w, "stop");
                    },
                    accelerator: "Esc",
                },
                {
                    label: t("浏览器打开"),
                    click: (_i, w) => {
                        viewEvents(w, "browser");
                    },
                },
                {
                    label: t("保存到历史记录"),
                    click: (_i, w) => {
                        viewEvents(w, "add_history");
                    },
                    accelerator: "CmdOrCtrl+D",
                },
                {
                    label: t("开发者工具"),
                    click: (_i, w) => {
                        viewEvents(w, "dev");
                    },
                },
            ],
        },
        // { role: 'viewMenu' }
        {
            label: t("视图"),
            submenu: [
                { label: t("重新加载"), role: "reload" },
                { label: t("强制重载"), role: "forceReload" },
                { label: t("开发者工具"), role: "toggleDevTools" },
                { type: "separator" },
                {
                    label: t("历史记录"),
                    click: (_i, w) => {
                        mainEdit(w, "show_history");
                    },
                    accelerator: "CmdOrCtrl+Shift+H",
                },
                { type: "separator" },
                { label: t("实际大小"), role: "resetZoom", accelerator: "" },
                { label: t("放大"), role: "zoomIn" },
                { label: t("缩小"), role: "zoomOut" },
                { type: "separator" },
                { label: t("全屏"), role: "togglefullscreen" },
            ],
        },
        // { role: 'windowMenu' }
        {
            label: t("窗口"),
            submenu: [
                { label: t("最小化"), role: "minimize" },
                { label: t("关闭"), role: "close" },
                ...(isMac
                    ? [
                          { type: "separator" },
                          { label: t("置于最前面"), role: "front" },
                          { type: "separator" },
                          { label: t("窗口"), role: "window" },
                      ]
                    : []),
            ],
        },
        {
            label: t("帮助"),
            role: "help",
            submenu: [
                {
                    label: t("教程帮助"),
                    click: () => {
                        createHelpWindow();
                    },
                },
                { type: "separator" },
                {
                    label: t("关于"),
                    click: () => {
                        createSettingWindow(true);
                    },
                },
            ],
        },
    ] as (Electron.MenuItemConstructorOptions | Electron.MenuItem)[];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
});

app.on("will-quit", () => {
    // Unregister all shortcuts.
    globalShortcut.unregisterAll();

    // 删除临时文件夹
    rmR(path.join(os.tmpdir(), "eSearch"));
});

var theIcon = null;
if (process.platform == "win32") {
    theIcon = path.join(runPath, "assets/logo/icon.ico");
} else {
    theIcon = path.join(runPath, "assets/logo/1024x1024.png");
}

// 截屏窗口
/**
 * @type BrowserWindow
 */
var clipWindow: BrowserWindow = null;
var clipWindowLoaded = false;
/** 初始化截屏后台窗口 */
function createClipWindow() {
    clipWindow = new BrowserWindow({
        icon: theIcon,
        width: screen.getPrimaryDisplay().workAreaSize.width,
        height: screen.getPrimaryDisplay().workAreaSize.height,
        show: false,
        alwaysOnTop: !dev, // 为了方便调试，调试模式就不居上了
        fullscreenable: true,
        transparent: true,
        frame: false,
        resizable: process.platform == "linux", // gnome下为false时无法全屏
        skipTaskbar: true,
        autoHideMenuBar: true,
        movable: false,
        enableLargerThanScreen: true, // mac
        hasShadow: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    if (!dev) clipWindow.setAlwaysOnTop(true, "screen-saver");

    rendererPath(clipWindow, "capture.html");
    clipWindow.webContents.on("did-finish-load", () => {
        clipWindow.webContents.setZoomFactor(store.get("全局.缩放") || 1.0);
        if (clipWindowLoaded) return;
        clipWindowLoaded = true;
        if (firstOpen) argRun(process.argv);
    });

    if (dev) clipWindow.webContents.openDevTools();

    clipWindow.webContents.on("render-process-gone", (_e, d) => {
        console.log(d);
    });

    // * 监听截屏奇奇怪怪的事件
    ipcMain.on("clip_main_b", (event, type, arg) => {
        switch (type) {
            case "window-close":
                exitFullScreen();
                isLongStart = false;
                break;
            case "ocr":
                ocr(arg);
                break;
            case "search":
                imageSearch(arg);
                break;
            case "QR":
                createMainWindow({ type: "qr", content: arg });
                break;
            case "open":
                dialog
                    .showOpenDialog({
                        title: t("选择要打开应用的位置"),
                    })
                    .then((x) => {
                        console.log(x);
                        event.sender.send("open_path", x.filePaths[0]);
                    });
                break;
            case "save":
                var savedPath = store.get("保存.保存路径.图片") || "";
                exitFullScreen();
                dialog
                    .showSaveDialog({
                        title: t("选择要保存的位置"),
                        defaultPath: path.join(savedPath, `${getFileName()}.${arg}`),
                        filters: [{ name: t("图像"), extensions: [arg] }],
                    })
                    .then((x) => {
                        event.sender.send("save_path", x.filePath);
                        if (x.filePath) {
                        } else {
                            new Notification({
                                title: `${app.name} ${t("保存图像失败")}`,
                                body: t("用户已取消保存"),
                                icon: `${runPath}/assets/logo/64x64.png`,
                            }).show();
                            clipWindow.show();
                            clipWindow.setSimpleFullScreen(true);
                        }
                    });
                break;
            case "ding":
                createDingWindow(arg[0], arg[1], arg[2], arg[3], arg[4]);
                break;
            case "mac_app":
                exitFullScreen();
                dialog
                    .showOpenDialog({
                        defaultPath: "/Applications",
                    })
                    .then((x) => {
                        if (x.canceled) {
                            clipWindow.show();
                            clipWindow.setSimpleFullScreen(true);
                        }
                        event.sender.send("mac_app_path", x.canceled, x.filePaths);
                    });
                break;
            case "ok_save":
                noti(arg);
                store.set("保存.保存路径.图片", path.dirname(arg));
                break;
            case "record":
                createRecorderWindow(arg.rect, { id: arg.id, w: arg.w, h: arg.h, r: arg.ratio });
                break;
            case "long_s":
                // n_full_screen();
                isLongStart = true;
                longWin(arg);
                break;
            case "long_e":
                isLongStart = false;
                break;
            case "new_version":
                var notification = new Notification({
                    title: `${app.name} ${t("有新版本：")}${arg.v}`,
                    body: `${t("点击下载")}`,
                    icon: `${runPath}/assets/logo/64x64.png`,
                });
                notification.on("click", () => {
                    shell.openExternal(arg.url);
                });
                notification.show();
                break;
            case "get_mouse":
                event.returnValue = screen.getCursorScreenPoint();
                break;
            case "translate":
                createTranslator(arg);
                break;
        }
    });
}

/**
 * 获取图片并全屏
 * @param {?string} imgPath 路径
 */
function fullScreen(imgPath?: string) {
    let nearestScreen = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (imgPath) {
        console.log(imgPath);
        fs.readFile(imgPath, (err, data) => {
            if (err) console.error(err);
            let p = nativeImage.createFromBuffer(data);
            let s = p.getSize();
            let d = { ...screen.getPrimaryDisplay(), image: data, main: true };
            d.id = null;
            d.bounds = { x: 0, y: 0, width: s.width, height: s.height };
            d.size = { width: s.width, height: s.height };
            d.scaleFactor = 1;
            sendCaptureEvent([d]);
        });
    } else {
        sendCaptureEvent();
    }
    clipWindow.setBounds({ x: nearestScreen.bounds.x, y: nearestScreen.bounds.y });
    clipWindow.show();
    clipWindow.setSimpleFullScreen(true);
}

function sendCaptureEvent(
    data?: (Electron.Display & { image: Buffer; main: boolean })[],
    type?: "ocr" | "image_search"
) {
    clipWindow.webContents.send(
        "reflash",
        data || screen.getAllDisplays(),
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id,
        type
    );
}

/** 隐藏截屏窗口 */
function exitFullScreen() {
    clipWindow.setSimpleFullScreen(false);
    clipWindow.hide();
}

/** 刷新（初始化）截屏窗口 */
function reload_clip() {
    exitFullScreen();
    if (clipWindow && !clipWindow.isDestroyed() && !clipWindow.isVisible()) clipWindow.reload();
}

function ocr(arg) {
    createMainWindow({ type: "ocr", content: arg[0], arg0: arg[1] });
}

function imageSearch(arg) {
    createMainWindow({ type: "image", content: arg[0], arg0: arg[1] });
}

var recording = false;
const recorderWinW = 240;
const recorderWinH = 24;

var recorder: BrowserWindow;
var recorderTipWin: BrowserWindow;
function createRecorderWindow(rect0, screenx: { id: string; w: number; h: number; r: number }) {
    let s = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    let ratio = screenx.r;
    let p = { x: screen.getCursorScreenPoint().x * ratio, y: screen.getCursorScreenPoint().y * ratio };
    const rect = rect0.map((v) => v / ratio);
    let hx = s.bounds.x + rect[0] + rect[2] / 2,
        hy = s.bounds.y + rect[1] + rect[3] / 2,
        w = recorderWinW,
        h = recorderWinH,
        sw = s.bounds.x + s.bounds.width * ratio,
        sh = s.bounds.y + s.bounds.height * ratio;
    let x = p.x <= hx ? s.bounds.x + rect[0] : s.bounds.x + rect[0] + rect[2] - w,
        y = p.y <= hy ? s.bounds.y + rect[1] - h - 8 : s.bounds.y + rect[1] + rect[3] + 8;
    x = x < s.bounds.x ? s.bounds.x : x;
    x = x + w > sw ? sw - w : x;
    y = y < s.bounds.y ? s.bounds.y : y;
    y = y + h > sh ? sh - h : y;
    x = Math.round(x);
    y = Math.round(y);
    recorder = new BrowserWindow({
        icon: theIcon,
        x,
        y,
        width: w,
        height: h,
        transparent: true,
        frame: false,
        autoHideMenuBar: true,
        resizable: process.platform == "linux",
        titleBarStyle: "hiddenInset",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false,
        },
    });
    rendererPath(recorder, "recorder.html");
    if (dev) recorder.webContents.openDevTools();

    recorder.setAlwaysOnTop(true, "screen-saver");

    recorder.on("close", () => {
        store.set("录屏.大小.x", recorder.getBounds().x);
        store.set("录屏.大小.y", recorder.getBounds().y);
        if (!recorderTipWin.isDestroyed) recorderTipWin.close();
    });

    recorder.on("resize", () => {
        if (recorder.isResizable()) {
            store.set("录屏.大小.width", recorder.getBounds().width);
            store.set("录屏.大小.height", recorder.getBounds().height);
        }
    });

    recorder.webContents.on("did-finish-load", () => {
        desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
            let dId = "";
            sources.forEach((s) => {
                if (s.display_id == screenx.id) dId = s.id;
            });
            if (!dId) dId = sources[0].id;
            recorder.webContents.send("record", "init", dId, rect, screenx.w, screenx.h, screenx.r);
        });
    });

    globalShortcut.register("Super+R", () => {
        if (!recorder.isDestroyed()) {
            recorder.webContents.send("record", "start_stop");
        }
    });

    const border = 2;
    const rect1 = rect0.map((v) => Math.round(v / ratio));
    recorderTipWin = new BrowserWindow({
        x: rect1[0] - border,
        y: rect1[1] - border,
        width: rect1[2] + border * 2,
        height: rect1[3] + border * 2,
        transparent: true,
        frame: false,
        autoHideMenuBar: true,
        resizable: process.platform == "linux",
        titleBarStyle: "hiddenInset",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false,
        },
    });
    rendererPath(recorderTipWin, "recorderTip.html");
    if (dev) recorderTipWin.webContents.openDevTools();

    recorderTipWin.setAlwaysOnTop(true, "screen-saver");

    recorderTipWin.setIgnoreMouseEvents(true);

    const tipB = recorderTipWin.getBounds();

    function mouse() {
        if (recorderTipWin.isDestroyed()) return;
        if (!recording || recorder.isDestroyed()) {
            return;
        }
        let nowXY = screen.getCursorScreenPoint();
        recorderTipWin.webContents.send("record", "mouse", { x: nowXY.x - tipB.x, y: nowXY.y - tipB.y });
        setTimeout(mouse, 10);
    }
    recording = true;
    if (store.get("录屏.提示.光标.开启")) mouse();
}

ipcMain.on("record", (_event, type, arg) => {
    switch (type) {
        case "stop":
            recorderTipWin.close();
            recording = false;
            break;
        case "start":
            break;
        case "ff": // 处理视频
            var savedPath = store.get("保存.保存路径.视频") || "";
            dialog
                .showSaveDialog({
                    title: t("选择要保存的位置"),
                    defaultPath: path.join(savedPath, `${getFileName()}.${arg.格式}`),
                    filters: [{ name: t("视频"), extensions: null }],
                })
                .then(async (x) => {
                    if (x.filePath) {
                        let fpath = x.filePath;
                        if (!fpath.includes(".")) {
                            fpath += `.${arg.格式}`;
                        }
                        recorder.webContents.send("ff", "save_path", fpath);
                    } else {
                        new Notification({
                            title: `${app.name} ${t("保存视频失败")}`,
                            body: t("用户已取消保存"),
                            icon: `${runPath}/assets/logo/64x64.png`,
                        }).show();
                    }
                });
            break;
        case "close":
            recorder.close();
            reload_clip();
            break;
        case "min":
            recorder.minimize();
            break;
        case "camera":
            switch (arg) {
                case 0:
                    // 摄像头
                    recorder.setBounds({
                        width: store.get("录屏.大小.width") || 800,
                        height: store.get("录屏.大小.height") || 600,
                        x: recorder.getBounds().x,
                        y: recorder.getBounds().y,
                    });
                    recorder.setResizable(true);
                    break;
                case 1:
                    // 摄像头关
                    recorder.setResizable(false);
                    recorder.setBounds({
                        width: recorderWinW,
                        height: recorderWinH,
                        x: recorder.getBounds().x,
                        y: recorder.getBounds().y,
                    });
                    break;
                case 2:
                    // 预览界面
                    recorder.setBounds({
                        width: Math.max(store.get("录屏.大小.width"), 300) || 800,
                        height: Math.max(store.get("录屏.大小.height"), 500) || 600,
                    });
                    recorder.setAlwaysOnTop(false);
                    recorder.setResizable(true);
                    recorder.center();
                    break;
            }
            break;
        case "pause_time":
            break;
    }
});

ipcMain.on("setting", async (event, arg, arg1, arg2) => {
    switch (arg) {
        case "save_err":
            console.log("保存设置失败");
            break;
        case "reload_main":
            if (clipWindow && !clipWindow.isDestroyed() && !clipWindow.isVisible()) clipWindow.reload();
            contextMenu.items[8].checked = store.get("浏览器中打开");
            tray.popUpContextMenu(contextMenu);
            tray.closeContextMenu();
            break;
        case "set_default_setting":
            store.clear();
            setDefaultSetting();
            var resolve = await dialog.showMessageBox({
                title: t("重启"),
                message: `${t("已恢复默认设置，部分设置需要重启")} ${app.name} ${t("生效")}`,
                buttons: [t("重启"), t("稍后")],
                defaultId: 0,
                cancelId: 1,
            });
            if (resolve.response == 0) {
                app.relaunch();
                app.exit(0);
            }
            break;
        case "reload":
            app.relaunch();
            app.exit(0);
            break;
        case "clear":
            let ses = session.defaultSession;
            if (arg1 == "storage") {
                ses.clearStorageData()
                    .then(() => {
                        event.sender.send("setting", "storage", true);
                    })
                    .catch(() => {
                        event.sender.send("setting", "storage", false);
                    });
            } else {
                Promise.all([
                    ses.clearAuthCache(),
                    ses.clearCache(),
                    ses.clearCodeCaches({}),
                    ses.clearHostResolverCache(),
                ])
                    .then(() => {
                        event.sender.send("setting", "cache", true);
                    })
                    .catch(() => {
                        event.sender.send("setting", "cache", false);
                    });
            }
            break;
        case "open_dialog":
            dialog.showOpenDialog(arg1).then((x) => {
                event.sender.send("setting", arg, arg2, x);
            });
            break;
        case "move_user_data":
            if (!arg1) return;
            const toPath = path.resolve(arg1);
            const prePath = app.getPath("userData");
            fs.mkdirSync(toPath, { recursive: true });
            if (process.platform == "win32") {
                exec(`xcopy ${prePath}\\** ${toPath} /Y /s`);
            } else {
                exec(`cp -r ${prePath}/** ${toPath}`);
            }
    }
});

// 长截屏

var isLongStart = false;

function longWin(rect) {
    clipWindow.setIgnoreMouseEvents(true);
    function mouse() {
        if (!isLongStart) {
            clipWindow.setIgnoreMouseEvents(false);
            return;
        }
        if (clipWindow.isDestroyed()) return;
        let nowXY = screen.getCursorScreenPoint();
        let ratio = screen.getPrimaryDisplay().scaleFactor;
        if (
            rect[0] + rect[2] - 16 <= nowXY.x * ratio &&
            nowXY.x * ratio <= rect[0] + rect[2] &&
            rect[1] + rect[3] - 16 <= nowXY.y * ratio &&
            nowXY.y * ratio <= rect[1] + rect[3]
        ) {
            clipWindow.setIgnoreMouseEvents(false);
        } else {
            clipWindow.setIgnoreMouseEvents(true);
        }
        setTimeout(mouse, 10);
    }
    mouse();
}

const isMac = process.platform === "darwin";

// ding窗口
var dingwindowList: { [key: string]: { win: BrowserWindow; display: Electron.Display } } = {};
function createDingWindow(x: number, y: number, w: number, h: number, img) {
    if (Object.keys(dingwindowList).length == 0) {
        const screenL = screen.getAllDisplays();
        const id = new Date().getTime();
        for (let i of screenL) {
            dingwindowList[i.id] = { win: null, display: i };
            let dingWindow = (dingwindowList[i.id].win = new BrowserWindow({
                icon: theIcon,
                transparent: true,
                frame: false,
                alwaysOnTop: true,
                skipTaskbar: true,
                autoHideMenuBar: true,
                enableLargerThanScreen: true, // mac
                hasShadow: false,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                },
                x: i.bounds.x,
                y: i.bounds.y,
                width: i.bounds.width,
                height: i.bounds.height,
            }));

            rendererPath(dingWindow, "ding.html");
            if (dev) dingWindow.webContents.openDevTools();
            dingWindow.webContents.on("did-finish-load", () => {
                dingWindow.webContents.send("screen_id", i.id);
                dingWindow.webContents.send("img", id, x - i.bounds.x, y - i.bounds.y, w, h, img);
            });
            dingwindowList[i.id].win.setIgnoreMouseEvents(true);

            dingWindow.setAlwaysOnTop(true, "screen-saver");
        }
    } else {
        const id = new Date().getTime();
        for (let i in dingwindowList) {
            let b = dingwindowList[i].win.getBounds();
            dingwindowList[i].win.webContents.send("img", id, x - b.x, y - b.y, w, h, img);
        }
    }
    // 自动改变鼠标穿透
    function dingClickThrough() {
        let nowXY = screen.getCursorScreenPoint();
        for (let i in dingwindowList) {
            try {
                let b = dingwindowList[i].win.getBounds();
                dingwindowList[i].win.webContents.send("mouse", nowXY.x - b.x, nowXY.y - b.y);
            } catch (error) {}
        }
        setTimeout(dingClickThrough, 10);
    }
    dingClickThrough();
}
ipcMain.on("ding_ignore", (_event, v) => {
    for (let id in dingwindowList) {
        dingwindowList[id]?.win?.setIgnoreMouseEvents(v);
    }
});
ipcMain.on("ding_event", (_event, type, id, more) => {
    if (type == "close" && more) {
        for (let i in dingwindowList) {
            dingwindowList[i].win.close();
            delete dingwindowList[i];
        }
        return;
    }

    if (type === "move_start") {
        let nowXY = screen.getCursorScreenPoint();

        for (let i in dingwindowList) {
            const display = dingwindowList[i].display;
            more.x = nowXY.x - display.bounds.x;
            more.y = nowXY.y - display.bounds.y;
            dingwindowList[i].win.webContents.send("ding", type, id, more);
        }
        return;
    }

    for (let i in dingwindowList) {
        dingwindowList[i].win.webContents.send("ding", type, id, more);
    }
});
ipcMain.on("ding_edit", (_event, img_path) => {
    fullScreen(img_path);
});

function createTranslator(op: translateWinType) {
    const win = new BrowserWindow({
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    win.setBounds({ x: op.dipRect.x, y: op.dipRect.y, width: op.dipRect.w, height: op.dipRect.h });

    rendererPath(win, "translator.html");
    if (dev) win.webContents.openDevTools();
    win.webContents.on("did-finish-load", () => {
        win.webContents.send("init", op.displayId, screen.getAllDisplays(), op.rect);
    });

    win.setAlwaysOnTop(true, "screen-saver");
}

// 主页面
var mainWindowL: { [n: number]: BrowserWindow } = {};

/**
 * @type {Object.<number, Array.<number>>}
 */
var mainToSearchL: { [n: number]: Array<number> } = {};
async function createMainWindow(op: MainWinType) {
    var windowName = new Date().getTime();
    var [w, h, m] = store.get("主页面大小");
    let vr = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds,
        px = screen.getCursorScreenPoint().x,
        py = screen.getCursorScreenPoint().y;
    let x = px > vr.x + vr.width / 2 ? px - w : px,
        y = py > vr.y + vr.height / 2 ? py - h : py;
    var mainWindow = (mainWindowL[windowName] = new BrowserWindow({
        x: Math.max(vr.x, x),
        y: Math.max(vr.y, y),
        width: w,
        height: h,
        minWidth: 800,
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f0f0f" : "#ffffff",
        icon: theIcon,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
        },
        show: true,
    })) as BrowserWindow & { html: string };

    mainToSearchL[windowName] = [];

    if (m) mainWindow.maximize();

    rendererPath(mainWindow, "editor.html");

    await mainWindow.webContents.session.setProxy(store.get("代理"));

    if (dev) mainWindow.webContents.openDevTools();

    mainWindow.webContents.on("did-finish-load", () => {
        mainWindow.webContents.setZoomFactor(store.get("全局.缩放") || 1.0);
        // 确保切换到index时能传递window_name
        mainWindow.webContents.send("text", windowName, op);

        if (op.type === "image" && op.arg0 === "ai") {
            createBrowser(windowName, "http://ai-v.netlify.app").then((c) => {
                c.executeJavaScript(`setImg("${op.content}")`);
            });
        }

        if (mainWindow.html) {
            mainWindow.webContents.send("html", mainWindow.html);
        }
    });

    mainWindow.on("close", () => {
        store.set("主页面大小", [
            mainWindow.getNormalBounds().width,
            mainWindow.getNormalBounds().height,
            mainWindow.isMaximized(),
        ]);
        for (let i of mainWindow.getBrowserViews()) {
            // @ts-ignore
            i?.webContents?.destroy();
        }
    });

    mainWindow.on("closed", () => {
        delete mainWindowL[windowName];
    });

    // 浏览器大小适应
    mainWindow.on("resize", () => {
        setTimeout(() => {
            var [w, h] = mainWindow.getContentSize();
            for (let i of mainWindow.getBrowserViews()) {
                if (i.getBounds().width != 0) i.setBounds({ x: 0, y: 0, width: w, height: h - 48 });
            }
        }, 0);
    });

    return windowName;
}

async function createSettingWindow(about?: boolean) {
    const settingWindow = new BrowserWindow({
        minWidth: 800,
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f0f0f" : "#ffffff",
        icon: theIcon,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
        },
        show: true,
    });

    rendererPath(settingWindow, "setting.html");

    await settingWindow.webContents.session.setProxy(store.get("代理"));

    if (dev) settingWindow.webContents.openDevTools();

    settingWindow.webContents.on("did-finish-load", () => {
        settingWindow.webContents.setZoomFactor(store.get("全局.缩放") || 1.0);
        settingWindow.webContents.send("about", about);
    });
}

async function createHelpWindow() {
    const helpWindow = new BrowserWindow({
        minWidth: 800,
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f0f0f" : "#ffffff",
        icon: theIcon,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
        },
        show: true,
    }) as BrowserWindow & { html: string };

    rendererPath(helpWindow, "help.html");

    await helpWindow.webContents.session.setProxy(store.get("代理"));

    if (dev) helpWindow.webContents.openDevTools();
}

ipcMain.on("main_win", (e, arg) => {
    switch (arg) {
        case "close":
            BrowserWindow.fromWebContents(e.sender).close();
            break;
    }
});

/**
 * 向聚焦的主页面发送事件信息
 * @param {String} m
 */
function mainEdit(window: BrowserWindow, m: string) {
    window.webContents.send("edit", m);
}

var searchWindowL: { [n: number]: BrowserView } = {};
ipcMain.on("open_url", (_event, window_name, url) => {
    createBrowser(window_name, url);
});

/** 创建浏览器页面 */
async function createBrowser(windowName: number, url: string) {
    if (!windowName) windowName = await createMainWindow({ type: "text", content: "" });

    let mainWindow = mainWindowL[windowName];

    if (mainWindow.isDestroyed()) return null;
    minViews(mainWindow);
    var view = new Date().getTime();
    let security = true;
    for (let i of store.get("nocors")) {
        if (url.includes(i)) {
            security = false;
            break;
        }
    }
    var searchView = (searchWindowL[view] = new BrowserView({ webPreferences: { webSecurity: security } }));
    await searchView.webContents.session.setProxy(store.get("代理"));
    mainWindowL[windowName].addBrowserView(searchView);
    searchView.webContents.loadURL(url);
    var [w, h] = mainWindow.getContentSize();
    searchView.setBounds({ x: 0, y: 0, width: w, height: h - 48 });
    mainWindow.setContentSize(w, h + 1);
    mainWindow.setContentSize(w, h);
    searchView.webContents.setWindowOpenHandler(({ url }) => {
        createBrowser(windowName, url);
        return { action: "deny" };
    });
    if (dev) searchView.webContents.openDevTools();
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send("url", view, "new", url);
    searchView.webContents.on("page-title-updated", (_event, title) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send("url", view, "title", title);
    });
    searchView.webContents.on("page-favicon-updated", (_event, favlogo) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send("url", view, "icon", favlogo);
    });
    searchView.webContents.on("did-navigate", (_event, url) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send("url", view, "url", url);
    });
    searchView.webContents.on("did-start-loading", () => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send("url", view, "load", true);
    });
    searchView.webContents.on("did-stop-loading", () => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send("url", view, "load", false);
    });
    searchView.webContents.on("did-fail-load", (_event, err_code, err_des) => {
        rendererPath2(searchView.webContents, "browser_bg.html", {
            query: { type: "did-fail-load", err_code: String(err_code), err_des },
        });
        if (dev) searchView.webContents.openDevTools();
    });
    searchView.webContents.on("render-process-gone", () => {
        rendererPath2(searchView.webContents, "browser_bg.html", { query: { type: "render-process-gone" } });
        if (dev) searchView.webContents.openDevTools();
    });
    searchView.webContents.on("unresponsive", () => {
        rendererPath2(searchView.webContents, "browser_bg.html", { query: { type: "unresponsive" } });
        if (dev) searchView.webContents.openDevTools();
    });
    searchView.webContents.on("responsive", () => {
        searchView.webContents.loadURL(url);
    });
    searchView.webContents.on("certificate-error", () => {
        rendererPath2(searchView.webContents, "browser_bg.html", { query: { type: "certificate-error" } });
        if (dev) searchView.webContents.openDevTools();
    });
    return new Promise((resolve: (x: Electron.WebContents) => void) => {
        searchView.webContents.on("did-finish-load", () => {
            resolve(searchView.webContents);
        });
    });
}
/**
 * 标签页事件
 * @param {BrowserWindow} w 浏览器
 * @param {String} arg 事件字符
 */
function viewEvents(w: BrowserWindow, arg: string) {
    w.webContents.send("view_events", arg);
}

ipcMain.on("tab_view", (e, id, arg, arg2) => {
    let mainWindow = BrowserWindow.fromWebContents(e.sender);
    let searchWindow = searchWindowL[id];
    switch (arg) {
        case "close":
            mainWindow.removeBrowserView(searchWindow);
            // @ts-ignore
            searchWindow.webContents.destroy();
            delete searchWindowL[id];
            break;
        case "top":
            // 有时直接把主页面当成浏览器打开，这时pid未初始化就触发top了，直接忽略
            if (!mainWindow) return;
            mainWindow.setTopBrowserView(searchWindow);
            minViews(mainWindow);
            searchWindow.setBounds({
                x: 0,
                y: 0,
                width: mainWindow.getContentBounds().width,
                height: mainWindow.getContentBounds().height - 48,
            });
            break;
        case "back":
            searchWindow.webContents.goBack();
            break;
        case "forward":
            searchWindow.webContents.goForward();
            break;
        case "stop":
            searchWindow.webContents.stop();
            break;
        case "reload":
            searchWindow.webContents.reload();
            break;
        case "home":
            minViews(mainWindow);
            break;
        case "save_html":
            mainWindow["html"] = arg2;
            minViews(mainWindow);
            break;
        case "dev":
            searchWindow.webContents.openDevTools();
            break;
    }
});

/** 最小化某个窗口的所有标签页 */
function minViews(mainWindow: BrowserWindow) {
    for (let v of mainWindow.getBrowserViews()) {
        v.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
}

/** 生成一个文件名 */
function getFileName() {
    var saveNameTime = time_format(store.get("保存名称.时间"), new Date()).replace("\\", "");
    var fileName = store.get("保存名称.前缀") + saveNameTime + store.get("保存名称.后缀");
    return fileName;
}
/** 快速截屏 */
function quickClip() {
    if (clipWindow.webContents) clipWindow.webContents.send("quick");
}

/** 提示保存成功 */
function noti(filePath: string) {
    var notification = new Notification({
        title: `${app.name} ${t("保存图像成功")}`,
        body: `${t("已保存图像到")} ${filePath}`,
        icon: `${runPath}/assets/logo/64x64.png`,
    });
    notification.on("click", () => {
        shell.showItemInFolder(filePath);
    });
    notification.show();
}

ipcMain.on("get_save_path", (event, path) => {
    if (!path) path = app.getPath("pictures");
    dialog
        .showOpenDialog({
            title: t("选择要保存的位置"),
            defaultPath: path,
            properties: ["openDirectory"],
        })
        .then((x) => {
            if (x.filePaths[0]) event.sender.send("get_save_path", x.filePaths[0] + "/");
        });
});

ipcMain.on("theme", (_e, v) => {
    nativeTheme.themeSource = v;
    store.set("全局.深色模式", v);
});

// 默认设置
var defaultSetting: setting = {
    首次运行: false,
    设置版本: app.getVersion(),
    启动提示: true,
    语言: {},
    快捷键: {
        自动识别: {
            key: "Alt+C",
        },
        截屏搜索: {},
        选中搜索: {},
        剪贴板搜索: {},
        快速截屏: {},
        主页面: {},
    },
    点击托盘自动截图: process.platform != "linux",
    工具快捷键: {
        close: "Escape",
        ocr: "Enter",
        search: "",
        QR: "",
        open: "",
        ding: "",
        record: "",
        long: "",
        copy: isMac ? "Command+C" : "Control+C",
        save: isMac ? "Command+S" : "Control+S",
        screens: "",
        translate: "",
    },
    截屏编辑快捷键: {
        select: { 键: "", 副: { rect: "", free: "", draw: "" } },
        draw: { 键: "", 副: { free: "", eraser: "", spray: "" } },
        shape: {
            键: "",
            副: { arrow: "", circle: "", line: "", number: "", polygon: "", polyline: "", rect: "", text: "" },
        },
        filter: { 键: "", 副: { "": "" } },
    },
    其他快捷键: {
        复制颜色: "K",
    },
    主搜索功能: {
        自动搜索排除: [],
        剪贴板选区搜索: true,
        截屏搜索延迟: 0,
    },
    全局: {
        模糊: 25,
        缩放: 1,
        不透明度: 0.4,
        深色模式: "system",
        图标颜色: ["", "", "", ""],
    },
    工具栏: {
        按钮大小: 60,
        按钮图标比例: 0.7,
        初始位置: { left: "10px", top: "100px" },
        功能: ["close", "screens", "ocr", "search", "QR", "open", "ding", "record", "long", "copy", "save"],
    },
    字体: {
        主要字体: "",
        等宽字体: "",
        记住: false,
        大小: 16,
    },
    编辑器: {
        自动换行: true,
        拼写检查: false,
        行号: true,
    },
    工具栏跟随: "展示内容优先",
    自动搜索: true,
    遮罩颜色: "#0008",
    选区颜色: "#0000",
    鼠标跟随栏: {
        显示: true,
    },
    取色器: { 像素大小: 10, 大小: 15, 显示: true, 默认格式: "HEX" },
    显示四角坐标: true,
    框选: {
        自动框选: {
            开启: false,
            图像识别: false,
            最小阈值: 50,
            最大阈值: 150,
        },
        记忆: { 开启: false, rects: {} },
    },
    图像编辑: {
        默认属性: {
            填充颜色: "#fff",
            边框颜色: "#333",
            边框宽度: 1,
            画笔颜色: "#333",
            画笔粗细: 2,
        },
        复制偏移: {
            x: 10,
            y: 10,
        },
        形状属性: {},
        记忆: {
            select: "rect",
            draw: "free",
            shape: "rect",
            filter: "",
        },
    },
    OCR: {
        类型: "默认",
        离线切换: true,
        记住: false,
    },
    离线OCR: [["默认", "默认/ppocr_det.onnx", "默认/ppocr_rec.onnx", "默认/ppocr_keys_v1.txt"]],
    离线OCR配置: {
        node: false,
    },
    在线OCR: {
        baidu: {
            url: "",
            id: "",
            secret: "",
        },
        youdao: {
            id: "",
            secret: "",
        },
    },
    以图搜图: {
        引擎: "baidu",
        记住: false,
    },
    自动打开链接: false,
    自动搜索中文占比: 0.2,
    浏览器中打开: false,
    浏览器: {
        标签页: {
            自动关闭: true,
            小: false,
            灰度: false,
        },
    },
    保存: {
        默认格式: "png",
        保存路径: { 图片: "", 视频: "" },
        快速保存: false,
    },
    保存名称: { 前缀: "eSearch-", 时间: "YYYY-MM-DD-HH-mm-ss-S", 后缀: "" },
    jpg质量: 1,
    框选后默认操作: "no",
    快速截屏: { 模式: "clip", 路径: "" },
    搜索引擎: [
        ["Google", "https://www.google.com/search?q=%s"],
        ["百度", "https://www.baidu.com/s?wd=%s"],
        ["必应", "https://cn.bing.com/search?q=%s"],
        ["Yandex", "https://yandex.com/search/?text=%s"],
    ],
    翻译引擎: [
        ["Google", "https://translate.google.com.hk/?op=translate&text=%s"],
        ["Deepl", "https://www.deepl.com/translator#any/any/%s"],
        ["金山词霸", "http://www.iciba.com/word?w=%s"],
        ["百度", "https://fanyi.baidu.com/#auto/auto/%s"],
        ["腾讯", "https://fanyi.qq.com/?text=%s"],
        ["翻译树", "https://fanyishu.netlify.app/?text=%s"],
    ],
    引擎: {
        记住: false,
        默认搜索引擎: "百度",
        默认翻译引擎: "Google",
    },
    nocors: ["https://yuansou.netlify.app/"],
    历史记录设置: {
        保留历史记录: true,
        自动清除历史记录: false,
        d: 14,
        h: 0,
    },
    ding_dock: [0, 0],
    贴图: {
        窗口: {
            变换: `transform: rotateY(180deg);`,
            双击: "归位",
        },
    },
    代理: {
        mode: "direct",
        pacScript: "",
        proxyRules: "",
        proxyBypassRules: "",
    },
    主页面: {
        模式: "auto",
    },
    主页面大小: [800, 600, false],
    关闭窗口: {
        失焦: { 主页面: false },
    },
    时间格式: "MM/DD hh:mm:ss",
    硬件加速: true,
    更新: {
        检查更新: true,
        频率: "setting",
        dev: false,
        上次更新时间: 0,
    },
    录屏: {
        自动录制: 3,
        视频比特率: 2.5,
        摄像头: {
            默认开启: false,
            记住开启状态: false,
            镜像: false,
            背景: {
                模式: "none",
                模糊: 40,
                imgUrl: "",
                videoUrl: "",
                fit: "contain",
            },
        },
        音频: {
            默认开启: false,
            记住开启状态: false,
        },
        转换: {
            自动转换: false,
            格式: "webm",
            码率: 2.5,
            帧率: 30,
            其他: "",
            高质量gif: false,
            分段: 10,
        },
        提示: {
            键盘: {
                开启: false,
            },
            鼠标: {
                开启: false,
            },
            光标: {
                开启: false,
                样式: "width: 24px;\nheight: 24px;\nborder-radius: 50%;\nbackground-color: #ff08;",
            },
        },
    },
    插件: { 加载前: [], 加载后: [] },
};
try {
    defaultSetting.保存.保存路径.图片 = app.getPath("pictures");
    defaultSetting.保存.保存路径.视频 = app.getPath("videos");
} catch (e) {
    console.error(e);
}

function setDefaultSetting() {
    for (let i in defaultSetting) {
        if (i === "语言") {
            const supportLan = ["zh-HANS", "zh-HANT", "ar", "en", "eo", "es", "fr", "ru"];
            let lan = app.getLocale();
            let mainLan = lan.split("-")[0];
            if (mainLan === "zh") {
                lan = {
                    "zh-CN": "zh-HANS",
                    "zh-SG": "zh-HANS",
                    "zh-TW": "zh-HANT",
                    "zh-HK": "zh-HANT",
                }[lan];
            }
            let language = "";
            if (!supportLan.includes(lan) && !supportLan.includes(mainLan)) language = "zh-HANS";
            else language = lan;
            store.set(i, { 语言: language });
        } else {
            store.set(i, defaultSetting[i]);
        }
    }
}

// 增加设置项后，防止undefined
function fix_setting_tree() {
    if (store.get("设置版本") == app.getVersion()) return;
    var tree = "defaultSetting";
    walk(tree);
    function walk(path: string) {
        var x = eval(path);
        if (Object.keys(x).length == 0) {
            path = path.slice(tree.length + 1); /* 去除开头主tree */
            if (store.get(path) === undefined) store.set(path, x);
        } else {
            for (let i in x) {
                var c_path = path + "." + i;
                if (x[i].constructor === Object) {
                    walk(c_path);
                } else {
                    c_path = c_path.slice(tree.length + 1); /* 去除开头主tree */
                    if (store.get(c_path) === undefined) store.set(c_path, x[i]);
                }
            }
        }
    }
}
