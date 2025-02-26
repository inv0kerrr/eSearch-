/// <reference types="vite/client" />
// In the renderer process.
const { ipcRenderer, clipboard, nativeImage, shell } = require("electron") as typeof import("electron");
import hotkeys from "hotkeys-js";
import "../../../lib/template2.js";

// 获取设置
let configPath = new URLSearchParams(location.search).get("config_path");
const Store = require("electron-store");
var store = new Store({
    cwd: configPath || "",
});

if (store.get("框选.自动框选.开启")) {
    var cv = require("opencv.js");
}

var 工具栏跟随: string,
    光标: string,
    四角坐标: boolean,
    遮罩颜色: string,
    选区颜色: string,
    取色器默认格式: string,
    取色器格式位置: number,
    取色器显示: boolean,
    colorSize: number,
    colorISize: number,
    记忆框选: boolean,
    记忆框选值: { [id: string]: rect },
    bSize: number;
var allColorFormat = ["HEX", "RGB", "HSL", "HSV", "CMYK"];
function setSetting() {
    工具栏跟随 = store.get("工具栏跟随");
    光标 = store.get("光标");
    四角坐标 = store.get("显示四角坐标");
    取色器默认格式 = store.get("取色器.默认格式");
    for (let i in allColorFormat) {
        if (取色器默认格式 == allColorFormat[i]) {
            取色器格式位置 = Number(i) + 1;
            break;
        }
    }
    遮罩颜色 = store.get("遮罩颜色");
    选区颜色 = store.get("选区颜色");

    var 字体 = store.get("字体");
    document.documentElement.style.setProperty("--main-font", 字体.主要字体);
    document.documentElement.style.setProperty("--monospace", 字体.等宽字体);

    document.documentElement.style.setProperty("--icon-color", store.get("全局.图标颜色")[1]);
    if (store.get("全局.图标颜色")[3])
        document.documentElement.style.setProperty("--icon-color1", store.get("全局.图标颜色")[3]);

    var 模糊 = store.get("全局.模糊");
    if (模糊 != 0) {
        document.documentElement.style.setProperty("--blur", `blur(${模糊}px)`);
    } else {
        document.documentElement.style.setProperty("--blur", `none`);
    }

    document.documentElement.style.setProperty("--alpha", store.get("全局.不透明度"));

    取色器显示 = store.get("取色器.显示");
    colorSize = store.get("取色器.大小");
    colorISize = store.get("取色器.像素大小");
    document.documentElement.style.setProperty("--color-size", `${colorSize * colorISize}px`);
    document.documentElement.style.setProperty("--color-i-size", `${colorISize}px`);
    document.documentElement.style.setProperty("--color-i-i", `${colorSize}`);
    let 工具栏 = store.get("工具栏");
    document.documentElement.style.setProperty("--bar-size", `${工具栏.按钮大小}px`);
    bSize = 工具栏.按钮大小;
    document.documentElement.style.setProperty("--bar-icon", `${工具栏.按钮图标比例}`);
    let toolsOrder = store.get("工具栏.功能") as string[];
    toolBar.querySelectorAll(":scope > *").forEach((el: HTMLElement) => {
        let id = el.id.replace("tool_", "");
        let i = toolsOrder.indexOf(id);
        if (i != -1) {
            el.style.order = String(i);
        } else {
            el.style.display = "none";
        }
    });

    记忆框选 = store.get("框选.记忆.开启");
    记忆框选值 = store.get("框选.记忆.rects");

    toolBar.style.left = store.get("工具栏.初始位置.left");
    toolBar.style.top = store.get("工具栏.初始位置.top");
}

var 全局缩放 = store.get("全局.缩放") || 1.0;
var ratio = 1;
const editor = document.getElementById("editor");
editor.style.width = window.screen.width / 全局缩放 + "px";
const mainCanvas = <HTMLCanvasElement>document.getElementById("main_photo");
const clipCanvas = <HTMLCanvasElement>document.getElementById("clip_photo");
const drawCanvas = <HTMLCanvasElement>document.getElementById("draw_photo");
// 第一次截的一定是桌面,所以可提前定义
mainCanvas.width = clipCanvas.width = drawCanvas.width = window.screen.width * window.devicePixelRatio;
mainCanvas.height = clipCanvas.height = drawCanvas.height = window.screen.height * window.devicePixelRatio;
var zoomW = 0;
type rect = [number, number, number, number];
type point = { x: number; y: number };
var finalRect = [0, 0, mainCanvas.width, mainCanvas.height] as rect;
var freeSelect: point[] = [];
var screenPosition: { [key: string]: { x: number; y: number } } = {};

var toolBar = document.getElementById("tool_bar");
var drawBar = document.getElementById("draw_bar");

var nowScreenId = 0;

var allScreens: (Electron.Display & { captureSync: () => Buffer } & { image?: Buffer })[];

let Screenshots: typeof import("node-screenshots").Screenshots;
try {
    Screenshots = require("node-screenshots").Screenshots;
} catch (error) {
    shell.openExternal("https://esearch-app.netlify.app/download.html");
}

/**
 * 修复屏幕信息
 * @see https://github.com/nashaofu/node-screenshots/issues/18
 */
function dispaly2screen(displays: Electron.Display[], screens: import("node-screenshots").Screenshots[]) {
    allScreens = [];
    if (!screens) return;
    // todo 更新算法
    for (const i in displays) {
        const d = displays[i];
        const s = screens[i];
        allScreens.push({ ...d, captureSync: () => s.captureSync(true) });
    }
}

setSetting();
ipcRenderer.on("reflash", (_a, _displays: Electron.Display[], mainid: number, act) => {
    if (!_displays.find((i) => i["main"])) {
        dispaly2screen(_displays, Screenshots.all());
    }
    console.log(allScreens);
    let mainId = mainid;
    for (let i of allScreens) {
        if (i["main"] || i.id === mainId) {
            if (!i["image"]) i["image"] = i.captureSync();
            setScreen(i);
            setEditorP(1 / i.scaleFactor, 0, 0);
            zoomW = i.size.width;
            ratio = i.scaleFactor;
        }
        screenPosition[i.id] = { x: i.bounds.x, y: i.bounds.y };

        if (i.bounds.width < window.innerWidth || i.bounds.height < window.innerHeight)
            document.body.classList.add("editor_bg");
    }
    const screensEl = document.getElementById("tool_screens");
    if (allScreens.length > 1) {
        let minX = 0;
        let maxX = 0;
        let minY = 0;
        let maxY = 0;
        for (let i of allScreens) {
            let right = i.bounds.x + i.bounds.width;
            let bottom = i.bounds.y + i.bounds.height;
            maxX = Math.max(maxX, right);
            maxY = Math.max(maxY, bottom);
            minX = Math.min(minX, i.bounds.x);
            minY = Math.min(minY, i.bounds.y);
        }
        let tWidth = maxX - minX;
        let tHeight = maxY - minY;
        let el = document.createElement("div");
        for (let i of allScreens) {
            let x = (i.bounds.x - minX) / tWidth;
            let y = (i.bounds.y - minY) / tHeight;
            let width = i.bounds.width / tWidth;
            let height = i.bounds.height / tHeight;
            let div = document.createElement("div");
            div.style.width = width * 100 + "%";
            div.style.height = height * 100 + "%";
            div.style.left = x * 100 + "%";
            div.style.top = y * 100 + "%";
            if (i.id === nowScreenId) {
                div.classList.add("now_screen");
            }
            el.append(div);
            div.onclick = () => {
                el.querySelector(".now_screen").classList.remove("now_screen");
                div.classList.add("now_screen");
                if (!i["image"]) i["image"] = i.captureSync();
                setScreen(i);
            };
        }
        screensEl.innerHTML = "";
        screensEl.append(el);
    } else {
        screensEl.style.display = "none";
    }

    switch (act) {
        case "ocr":
            finalRect = [0, 0, mainCanvas.width, mainCanvas.height];
            tool.ocr();
            break;
        case "image_search":
            finalRect = [0, 0, mainCanvas.width, mainCanvas.height];
            tool.search();
            break;
    }

    if (autoPhotoSelectRect) {
        setTimeout(() => {
            edge();
        }, 0);
    }

    getLinuxWin();
    getWinWin();

    drawClipRect();
    setTimeout(() => {
        whBar(finalRect);
    }, 0);
    rightKey = false;
    changeRightBar(false);
});

function toCanvas(canvas: HTMLCanvasElement, img: Electron.NativeImage) {
    const image = img;
    const { width: w, height: h } = image.getSize();

    canvas.width = w;
    canvas.height = h;

    let bitmap = image.toBitmap();
    let x = new Uint8ClampedArray(bitmap.length);
    for (let i = 0; i < bitmap.length; i += 4) {
        // 交换R和B通道的值，同时复制G和Alpha通道的值
        x[i] = bitmap[i + 2]; // B
        x[i + 1] = bitmap[i + 1]; // G
        x[i + 2] = bitmap[i]; // R
        x[i + 3] = bitmap[i + 3]; // Alpha
    }
    let d = new ImageData(x, w, h);
    canvas.getContext("2d").putImageData(d, 0, 0);
}

function setScreen(i: (typeof allScreens)[0]) {
    const img = nativeImage.createFromBuffer(i.image);
    let size = img.getSize();
    let w = size.width;
    let h = size.height;
    mainCanvas.width = clipCanvas.width = drawCanvas.width = w;
    mainCanvas.height = clipCanvas.height = drawCanvas.height = h;
    toCanvas(mainCanvas, img);
    fabricCanvas.setHeight(h);
    fabricCanvas.setWidth(w);
    finalRect = [0, 0, mainCanvas.width, mainCanvas.height];
    if (记忆框选)
        if (记忆框选值?.[i.id]?.[2]) {
            finalRect = 记忆框选值[i.id];
            rectSelect = true;
            finalRectFix();
        } // 记忆框选边不为0时
    drawClipRect();
    nowScreenId = i.id;
}

/** 生成一个文件名 */
function getFileName() {
    var saveNameTime = timeFormat(store.get("保存名称.时间"), new Date()).replace("\\", "");
    var filename = store.get("保存名称.前缀") + saveNameTime + store.get("保存名称.后缀");
    return filename;
}

/** 快速截屏 */
function quickClip() {
    const fs = require("fs");
    (Screenshots.all() ?? []).forEach((c) => {
        let image = nativeImage.createFromBuffer(c.captureSync(true));
        if (store.get("快速截屏.模式") == "clip") {
            clipboard.writeImage(image);
            image = null;
        } else if (store.get("快速截屏.模式") == "path" && store.get("快速截屏.路径")) {
            var filename = `${store.get("快速截屏.路径")}${getFileName()}.png`;
            checkFile(1, filename);
        }
        function checkFile(n, name) {
            // 检查文件是否存在于当前目录中。
            fs.access(name, fs.constants.F_OK, (err) => {
                if (!err) {
                    /* 存在文件，需要重命名 */
                    name = filename.replace(/\.png$/, `(${n}).png`);
                    checkFile(n + 1, name);
                } else {
                    filename = name;
                    fs.writeFile(
                        filename,
                        Buffer.from(image.toDataURL().replace(/^data:image\/\w+;base64,/, ""), "base64"),
                        (err) => {
                            if (err) return;
                            ipcRenderer.send("clip_main_b", "ok_save", filename);
                            image = null;
                        }
                    );
                }
            });
        }
    });
}

ipcRenderer.on("quick", quickClip);

let nowMouseE: MouseEvent = null;
document.addEventListener("mousemove", (e) => {
    nowMouseE = e;
});

document.onwheel = (e) => {
    if (!editor.contains(e.target as HTMLElement) && e.target != document.body) return;
    if (longRunning) return;

    document.body.classList.add("editor_bg");
    if (e.ctrlKey) {
        let zz = 1 + Math.abs(e.deltaY) / 300;
        let z = e.deltaY > 0 ? zoomW / zz : zoomW * zz;
        zoomW = z;
        let ozoom = editorP.zoom,
            nzoom = z / mainCanvas.width;
        let dx = nowMouseE.clientX - editorP.x * ozoom,
            dy = nowMouseE.clientY - editorP.y * ozoom;
        let x = nowMouseE.clientX - dx * (nzoom / ozoom),
            y = nowMouseE.clientY - dy * (nzoom / ozoom);
        setEditorP(nzoom, x / nzoom, y / nzoom);
    } else {
        let dx = 0,
            dy = 0;
        if (e.shiftKey && !e.deltaX) {
            dx = -e.deltaY;
        } else {
            dx = -e.deltaX;
            dy = -e.deltaY;
        }
        setEditorP(editorP.zoom, editorP.x + dx / editorP.zoom, editorP.y + dy / editorP.zoom);
    }
};

let editorP = { zoom: 1, x: 0, y: 0 };
function setEditorP(zoom: number, x: number, y: number) {
    let t = [];
    if (zoom != null) {
        t.push(`scale(${zoom})`);
        editorP.zoom = zoom;
    }
    if (x != null) {
        t.push(`translateX(${x}px)`);
        editorP.x = x;
    }
    if (y != null) {
        t.push(`translateY(${y}px)`);
        editorP.y = y;
    }
    editor.style.transform = t.join(" ");
}

document.onkeyup = (e) => {
    if (e.key == "0") {
        if (e.ctrlKey) {
            setEditorP(1, 0, 0);
            zoomW = mainCanvas.width;
        }
    }
};

let middleB: PointerEvent;
let middleP = { x: 0, y: 0 };
document.addEventListener("pointerdown", (e) => {
    if (e.button == 1) {
        middleB = e;
        middleP.x = editorP.x;
        middleP.y = editorP.y;
        document.body.classList.add("editor_bg");
    }
});
document.addEventListener("pointermove", (e) => {
    if (middleB) {
        let dx = e.clientX - middleB.clientX,
            dy = e.clientY - middleB.clientY;
        setEditorP(editorP.zoom, middleP.x + dx / editorP.zoom, middleP.y + dy / editorP.zoom);
    }
});
document.addEventListener("pointerup", (_e) => {
    middleB = null;
});

var edgeRect: { x: number; y: number; width: number; height: number; type: "system" | "image" }[] = [];
function edge() {
    let canvas = mainCanvas;
    let src = cv.imread(canvas);

    cv.cvtColor(src, src, cv.COLOR_RGBA2RGB);
    // cv.imshow(canvas, src);

    let dst = new cv.Mat();
    let cMin = store.get("框选.自动框选.最小阈值"),
        cMax = store.get("框选.自动框选.最大阈值");
    cv.Canny(src, dst, cMin, cMax, 3, true);

    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    cv.findContours(dst, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

    for (let i = 0; i < contours.size(); i++) {
        let cnt = contours.get(i);
        let r = cv.boundingRect(cnt);
        r["type"] = "image";
        edgeRect.push(r);
    }

    // cv.imshow(canvas, dst);

    src.delete();
    dst.delete();
    contours.delete();
    hierarchy.delete();

    src = dst = contours = hierarchy = null;
}

function getLinuxWin() {
    if (process.platform != "linux") return;
    var x11 = require("x11");
    var X = x11.createClient(function (err, display) {
        if (err) {
            console.error(err);
            return;
        }
        for (let i of display.screen) {
            X.QueryTree(i.root, (_err, tree) => {
                for (let x of tree.children) {
                    X.GetWindowAttributes(x, function (_err, attrs) {
                        if (attrs.mapState == 2) {
                            X.GetGeometry(x, function (_err, clientGeom) {
                                edgeRect.push({
                                    x: clientGeom.xPos,
                                    y: clientGeom.yPos,
                                    width: clientGeom.width,
                                    height: clientGeom.height,
                                    type: "system",
                                });
                            });
                        }
                    });
                }
            });
        }
    });
}

function getWinWin() {
    if (process.platform != "win32") return;
    let { exec } = require("child_process");
    let runPath = ipcRenderer.sendSync("run_path");
    exec(`${runPath}/lib/win_rect.exe`, (err, out) => {
        console.log(out);
        if (!err) {
            out = out.replaceAll("\x00", "");
            let r = JSON.parse(out);
            for (let i of r) edgeRect.push({ x: i.x, y: i.y, width: i.width, height: i.height, type: "system" });
        }
    });
}

var bScope = null;
var centerBarShow = false;
var centerBarM = null;
function sCenterBar(m) {
    hotkeys.deleteScope("c_bar");
    if (centerBarM == m) {
        centerBarShow = false;
        centerBarM = null;
    } else {
        centerBarShow = true;
        centerBarM = m;
    }
    if (m === false) centerBarShow = false;
    if (centerBarShow) {
        document.getElementById("save_type").style.height = "0";
        document.getElementById("draw_edit").style.height = "0";
        document.getElementById("save_type").style.width = "0";
        document.getElementById("draw_edit").style.width = "0";
        document.getElementById("center_bar").style.opacity = "1";
        document.getElementById("center_bar").style.pointerEvents = "auto";
        if (hotkeys.getScope() != "all") bScope = hotkeys.getScope();
        hotkeys.setScope("c_bar");
    } else {
        document.getElementById("center_bar").style.opacity = "0";
        document.getElementById("center_bar").style.pointerEvents = "none";
        hotkeys.setScope(bScope || "normal");
    }
    switch (m) {
        case "save":
            document.getElementById("save_type").style.height = "";
            document.getElementById("save_type").style.width = "";
            break;
        case "edit":
            document.getElementById("draw_edit").style.height = "";
            document.getElementById("draw_edit").style.width = "";
            break;
    }
}

var tool = {
    close: () => closeWin(),
    ocr: () => runOcr(),
    search: () => runSearch(),
    QR: () => runQr(),
    open: () => openApp(),
    record: () => initRecord(),
    long: () => startLong(),
    translate: () => translate(),
    // 钉在屏幕上
    ding: () => runDing(),
    // 复制
    copy: () => runCopy(),
    save: () => runSave(),
};

// 工具栏按钮
toolBar.onmouseup = (e) => {
    var el = <HTMLElement>e.target;
    if (el.parentElement != toolBar) return;
    if (e.button == 0) {
        tool[el.id.replace("tool_", "")]();
    }
    // 中键取消抬起操作
    if (e.button == 1) {
        el.style.backgroundColor = "";
        autoDo = "no";
    }
};

var drawMainEls: { [key in keyof EditType]: HTMLElement } = {
    select: document.getElementById("draw_select"),
    draw: document.getElementById("draw_free"),
    shape: document.getElementById("draw_shapes"),
    filter: document.getElementById("draw_filters"),
};
var shapeEl = {} as { [key in EditType["shape"]]: HTMLElement };
document.querySelectorAll("#draw_shapes_i > div").forEach((el: HTMLInputElement) => {
    shapeEl[el.id.replace("draw_shapes_", "") as shape] = el;
});
var drawSideEls: { [key in keyof EditType]: { [key1 in EditType[key]]: HTMLElement } } = {
    select: {
        rect: document.getElementById("draw_select_rect"),
        free: document.getElementById("draw_select_free"),
        draw: document.getElementById("draw_select_draw"),
    },
    draw: {
        free: document.getElementById("draw_free_pencil"),
        eraser: document.getElementById("draw_free_eraser"),
        spray: document.getElementById("draw_free_spray"),
    },
    filter: { "": null },
    shape: shapeEl,
};

hotkeys.filter = (event) => {
    var tagName = (<HTMLElement>(event.target || event.srcElement)).tagName;
    var v =
        !(
            (<HTMLElement>event.target).isContentEditable ||
            tagName == "INPUT" ||
            tagName == "SELECT" ||
            tagName == "TEXTAREA"
        ) || event.target === document.querySelector("#draw_edit input");
    return v;
};

hotkeys.setScope("normal");
let toolList: 功能[] = ["close", "screens", "ocr", "search", "QR", "open", "ding", "record", "long", "copy", "save"];
for (let k of toolList) {
    hotkeys(store.get(`工具快捷键.${k}`), "normal", tool[k]);
}
let drawHotKey: setting["截屏编辑快捷键"] = store.get(`截屏编辑快捷键`);
for (let i in drawHotKey) {
    let mainKey = i as keyof EditType;
    drawMainEls[mainKey].setAttribute("data-key", drawHotKey[mainKey].键);
    hotkeys(drawHotKey[mainKey].键, () => {
        setEditType(mainKey, editType[mainKey]);
    });
    for (let j in drawHotKey[mainKey].副) {
        drawSideEls[mainKey][j]?.setAttribute("data-key", drawHotKey[mainKey].副[j]);
        hotkeys(drawHotKey[mainKey].副[j], () => {
            setEditType(mainKey, j as EditType[keyof EditType]);
        });
    }
}

// alt显示快捷键
document.addEventListener("keydown", (e) => {
    if (e.key === "Alt") {
        document.documentElement.style.setProperty("--hotkey-show", "block");
    }
});
document.addEventListener("keyup", (e) => {
    if (e.key === "Alt") {
        document.documentElement.style.setProperty("--hotkey-show", "none");
    }
});

var autoDo = store.get("框选后默认操作");
if (autoDo != "no") {
    document.getElementById(`tool_${autoDo}`).style.backgroundColor = "var(--hover-color)";
}

function 记忆框选f() {
    if (记忆框选 && !longInited) {
        记忆框选值[nowScreenId] = [finalRect[0], finalRect[1], finalRect[2], finalRect[3]];
        store.set("框选.记忆.rects", 记忆框选值);
    }
}

// 关闭
function closeWin() {
    document.querySelector("html").style.display = "none"; /* 退出时隐藏，透明窗口，动画不明显 */
    记忆框选f();
    mainCanvas.width = clipCanvas.width = drawCanvas.width = mainCanvas.width; // 确保清空画布
    if (uIOhook) {
        uIOhook.stop();
    }
    setTimeout(() => {
        ipcRenderer.send("clip_main_b", "window-close");
        location.reload();
    }, 50);
}

// OCR
var ocr引擎 = <HTMLSelectElement>document.getElementById("ocr引擎");
for (let i of store.get("离线OCR")) {
    let o = document.createElement("option");
    o.innerText = `${i[0]}`;
    o.value = `${i[0]}`;
    ocr引擎.append(o);
}
ocr引擎.insertAdjacentHTML("beforeend", `<option value="baidu">百度</option><option value="youdao">有道</option>`);
ocr引擎.value = store.get("OCR.记住") || store.get("OCR.类型");
document.getElementById("ocr引擎").oninput = () => {
    if (store.get("OCR.记住")) store.set("OCR.记住", ocr引擎.value);
    tool.ocr();
};
document.getElementById("tool_ocr").title = `OCR(文字识别) - ${ocr引擎.value}`;

function runOcr() {
    const type = ocr引擎.value;
    getClipPhoto("png").then((c: HTMLCanvasElement) => {
        ipcRenderer.send("clip_main_b", "ocr", [c.toDataURL(), type]);
    });
    tool.close();
}

// 以图搜图
var 识图引擎 = <HTMLSelectElement>document.getElementById("识图引擎");
识图引擎.value = store.get("以图搜图.记住") || store.get("以图搜图.引擎");
识图引擎.oninput = () => {
    if (store.get("以图搜图.记住")) store.set("以图搜图.记住", 识图引擎.value);
    tool.search();
};
document.getElementById("tool_search").title = `以图搜图 - ${识图引擎.value}`;
function runSearch() {
    const type = 识图引擎.value;
    getClipPhoto("png").then((c: HTMLCanvasElement) => {
        ipcRenderer.send("clip_main_b", "search", [c.toDataURL(), type]);
    });
    tool.close();
}
// 二维码
function runQr() {
    getClipPhoto("png").then(async (c: HTMLCanvasElement) => {
        ipcRenderer.send("clip_main_b", "QR", c.toDataURL());
        tool.close();
    });
}
// 图片编辑
var drawing = false;

function drawM(v: boolean) {
    drawing = v;
    if (v) {
        // 绘画模式
        document.getElementById("clip_photo").style.pointerEvents = "none";
        document.getElementById("clip_wh").style.pointerEvents = "none";
    } else {
        // 裁切模式
        document.getElementById("clip_photo").style.pointerEvents = "auto";
        hotkeys.setScope("normal");
        fabricCanvas.discardActiveObject();
        fabricCanvas.renderAll();
        document.getElementById("clip_wh").style.pointerEvents = "auto";
    }
}
trackLocation();

/**
 * 编辑栏跟踪工具栏
 */
function trackLocation() {
    let h = toolBar.offsetTop;
    let l = toolBar.offsetLeft + toolBar.offsetWidth + 8;
    if (drawBarPosi == "left") {
        l = toolBar.offsetLeft - drawBar.offsetWidth - 8;
    }
    drawBar.style.top = `${h}px`;
    drawBar.style.left = `${l}px`;
}

// 在其他应用打开

import open_with from "../../../lib/open_with";

function openApp() {
    const path = require("path");
    const os = require("os");
    const tmpPhoto = path.join(os.tmpdir(), "/eSearch/tmp.png");
    const fs = require("fs");
    getClipPhoto("png").then((c: HTMLCanvasElement) => {
        var f = c.toDataURL().replace(/^data:image\/\w+;base64,/, "");
        var dataBuffer = new Buffer(f, "base64");
        fs.writeFile(tmpPhoto, dataBuffer, () => {
            open_with(tmpPhoto);
        });
    });
}

function initRecord() {
    ipcRenderer.send("clip_main_b", "record", {
        rect: finalRect,
        id: nowScreenId,
        w: mainCanvas.width,
        h: mainCanvas.height,
        ratio: ratio,
    });
    tool.close();
}

function long_s() {
    let s = allScreens.find((i) => i.id === nowScreenId);
    let x = nativeImage.createFromBuffer(s.captureSync());
    addLong(x.getBitmap(), x.getSize().width, x.getSize().height);
    s = x = null;
}

let uIOhook;

var logO = {
    longList: [] as { src: HTMLCanvasElement; temp: HTMLCanvasElement; after: HTMLCanvasElement }[],
    l: [] as { x: number; y: number }[],
    oCanvas: null,
    p: { x: 0, y: 0 },
};

function startLong() {
    logO.longList = [];
    initLong(finalRect);
    let r = [...finalRect];
    r[0] += screenPosition[nowScreenId].x;
    r[1] += screenPosition[nowScreenId].y;
    long_s();
    ipcRenderer.send("clip_main_b", "long_s", r);
    if (!cv) cv = require("opencv.js");
    logO.oCanvas = document.createElement("canvas");
    let oCanvas = logO.oCanvas;
    logO.p = { x: 0, y: 0 };
    oCanvas.width = finalRect[2];
    oCanvas.height = finalRect[3];
    logO.l = [];
    uIOhook = require("uiohook-napi").uIOhook;
    uIOhook.start();
    uIOhook.on("keyup", () => {
        long_s();
    });
    uIOhook.on("wheel", () => {
        long_s();
    });
}

function addLong(x: Buffer, w: number, h: number) {
    let longList = logO.longList;
    let oCanvas = logO.oCanvas;
    let p = logO.p;
    if (!x) {
        uIOhook.stop();
        uIOhook = null;
        pjLong();
        return;
    }
    // 原始区域
    let canvas = document.createElement("canvas");
    // 对比模板
    let canvasTop = document.createElement("canvas");
    // 要拼接的图片
    let canvasAfter = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    for (let i = 0; i < x.length; i += 4) {
        [x[i], x[i + 2]] = [x[i + 2], x[i]];
    }
    let d = new ImageData(Uint8ClampedArray.from(x), w, h);
    canvas.getContext("2d").putImageData(d, 0, 0);
    let gid = canvas.getContext("2d").getImageData(finalRect[0], finalRect[1], finalRect[2], finalRect[3]); // 裁剪

    // 设定canvas宽高并设置裁剪后的图像
    canvas.width = canvasTop.width = canvasAfter.width = finalRect[2];
    canvas.height = finalRect[3];
    const recHeight = Math.min(200, finalRect[3]);
    const recTop = Math.floor(finalRect[3] / 2 - recHeight / 2);
    canvasTop.height = recHeight; // 只是用于模板对比，小一点
    canvasAfter.height = finalRect[3] - recTop; // 裁剪顶部
    canvas.getContext("2d").putImageData(gid, 0, 0);
    canvasTop.getContext("2d").putImageData(gid, 0, -recTop);
    canvasAfter.getContext("2d").putImageData(gid, 0, -recTop);

    longList.push({ src: canvas, temp: canvasTop, after: canvasAfter });

    // 对比
    let i = longList.length - 2;
    if (i < 0) return;
    let src = cv.imread(longList[i].src);
    let templ = cv.imread(longList[i + 1].temp);
    let dst = new cv.Mat();
    let mask = new cv.Mat();
    cv.matchTemplate(src, templ, dst, cv.TM_CCOEFF, mask);
    let result = cv.minMaxLoc(dst, mask);
    let maxPoint = result.maxLoc;
    oCanvas.width += maxPoint.x;
    oCanvas.height += maxPoint.y;
    p.x += maxPoint.x;
    p.y += maxPoint.y;
    logO.l.push({ x: p.x, y: p.y });
    oCanvas.height -= recTop;
    p.y -= recTop;
    src.delete();
    dst.delete();
    mask.delete();
    longList[i + 1].temp = null;
}

var longRunning = false;
var longInited = false;

const lr = document.getElementById("long_rect");
function initLong(rect: number[]) {
    longRunning = true;
    longInited = true;
    let l = [
        toolBar,
        drawBar,
        mainCanvas,
        clipCanvas,
        drawCanvas,
        document.getElementById("draw_photo_top"),
        whEl,
        mouseBarEl,
        loadingEl,
    ];

    for (let i of l) {
        i.style.display = "none";
    }

    document.body.classList.remove("editor_bg");

    记忆框选值[nowScreenId] = [rect[0], rect[1], rect[2], rect[3]];
    store.set("框选.记忆.rects", 记忆框选值);

    lr.style.left = rect[0] / ratio + "px";
    lr.style.top = rect[1] / ratio + "px";
    lr.style.width = rect[2] / ratio + "px";
    lr.style.height = rect[3] / ratio + "px";
    document.getElementById("long_finish").onclick = () => {
        // 再截屏以覆盖结束按钮
        long_s();

        lr.style.opacity = "0";
        ipcRenderer.send("clip_main_b", "long_e", nowScreenId);
        addLong(null, null, null);
        for (let i of l) {
            i.style.display = "";
        }
    };

    showLoading("截屏拼接中");
    mainCanvas.style.filter = "blur(20px)";
}

function pjLong() {
    let l = logO.l,
        longList = logO.longList,
        oCanvas = logO.oCanvas;
    oCanvas.getContext("2d").drawImage(longList[0].src, 0, 0); // 先画顶部图片，使用原始区域
    for (let i = 0; i < longList.length - 1; i++) {
        oCanvas.getContext("2d").drawImage(longList[i + 1].after, l[i].x, l[i].y); // 每次拼接覆盖时底部总会被覆盖，所以不用管底部
    }
    mainCanvas.width = clipCanvas.width = drawCanvas.width = oCanvas.width;
    mainCanvas.height = clipCanvas.height = drawCanvas.height = oCanvas.height;

    let ggid = oCanvas.getContext("2d").getImageData(0, 0, oCanvas.width, oCanvas.height);
    mainCanvas.getContext("2d").putImageData(ggid, 0, 0);

    finalRect = [0, 0, oCanvas.width, oCanvas.height];

    fabricCanvas.setWidth(oCanvas.width);
    fabricCanvas.setHeight(oCanvas.height);

    mainCanvas.style.filter = "";
    hideLoading();

    document.body.classList.add("editor_bg");

    lr.style.width = lr.style.height = "0";

    longRunning = false;
}

// 钉在屏幕上
function runDing() {
    getClipPhoto("png").then((c: HTMLCanvasElement) => {
        const display = allScreens.find((i) => i.id === nowScreenId);
        const dingWindowArg = [
            finalRect[0] / ratio + display.bounds.x,
            finalRect[1] / ratio + display.bounds.y,
            finalRect[2] / ratio,
            finalRect[3] / ratio,
            c.toDataURL(),
        ];
        ipcRenderer.send("clip_main_b", "ding", dingWindowArg);
        tool.close();
    });
}

function translate() {
    const display = allScreens.find((i) => i.id === nowScreenId);
    ipcRenderer.send("clip_main_b", "translate", {
        rect: {
            x: finalRect[0],
            y: finalRect[1],
            w: finalRect[2],
            h: finalRect[3],
        },
        dipRect: {
            x: finalRect[0] / ratio + display.bounds.x,
            y: finalRect[1] / ratio + display.bounds.y,
            w: finalRect[2] / ratio,
            h: finalRect[3] / ratio,
        },
        displayId: nowScreenId,
    } as translateWinType);
    tool.close();
}

// 复制
function runCopy() {
    getClipPhoto("png").then((c: HTMLCanvasElement) => {
        clipboard.writeImage(nativeImage.createFromDataURL(c.toDataURL()));
        tool.close();
    });
}
// 保存
var type;
import timeFormat from "../../../lib/time_format";
function runSave() {
    if (store.get("保存.快速保存")) {
        type = store.get("保存.默认格式");
        const path = require("path") as typeof import("path");
        let savedPath = store.get("保存.保存路径.图片") || "";
        let p = path.join(savedPath, `${get_file_name()}.${store.get("保存.默认格式")}`);
        function get_file_name() {
            var saveNameTime = timeFormat(store.get("保存名称.时间"), new Date()).replace("\\", "");
            var filename = store.get("保存名称.前缀") + saveNameTime + store.get("保存名称.后缀");
            return filename;
        }
        save(p);
        return;
    }
    sCenterBar("save");
    var type2N = { png: 0, jpg: 1, svg: 2 };
    var i = type2N[store.get("保存.默认格式")];
    document.querySelectorAll("#suffix > div")[i].className = "suffix_h";
    document.getElementById("suffix").onclick = (e) => {
        var el = <HTMLDivElement>e.target;
        if (el.dataset.value) {
            ipcRenderer.send("clip_main_b", "save", el.dataset.value);
            type = el.dataset.value;
            sCenterBar("save");
        }
    };
    hotkeys.setScope("c_bar");
    hotkeys("enter", "c_bar", () => {
        (<HTMLDivElement>document.querySelector("#suffix > .suffix_h")).click();
        sCenterBar("save");
    });
    hotkeys("up", "c_bar", () => {
        document.querySelectorAll("#suffix > div")[i % 3].className = "";
        i = i == 0 ? 2 : i - 1;
        document.querySelectorAll("#suffix > div")[i % 3].className = "suffix_h";
    });
    hotkeys("down", "c_bar", () => {
        document.querySelectorAll("#suffix > div")[i % 3].className = "";
        i++;
        document.querySelectorAll("#suffix > div")[i % 3].className = "suffix_h";
    });
    hotkeys("esc", "c_bar", () => {
        sCenterBar("save");
    });
}
ipcRenderer.on("save_path", (_event, message) => {
    console.log(message);
    save(message);
});
function save(message: string) {
    if (message) {
        const fs = require("fs");
        getClipPhoto(type).then((c) => {
            switch (type) {
                case "svg":
                    var dataBuffer = Buffer.from(<string>c);
                    fs.writeFile(message, dataBuffer, (err) => {
                        if (!err) {
                            ipcRenderer.send("clip_main_b", "ok_save", message);
                        }
                    });
                    break;
                case "png":
                    var f = (<HTMLCanvasElement>c).toDataURL().replace(/^data:image\/\w+;base64,/, "");
                    var dataBuffer = Buffer.from(f, "base64");
                    fs.writeFile(message, dataBuffer, (err) => {
                        if (!err) {
                            ipcRenderer.send("clip_main_b", "ok_save", message);
                        }
                    });
                    break;
                case "jpg":
                    var f = (<HTMLCanvasElement>c)
                        .toDataURL("image/jpeg", store.get("jpg质量") - 0)
                        .replace(/^data:image\/\w+;base64,/, "");
                    var dataBuffer = Buffer.from(f, "base64");
                    fs.writeFile(message, dataBuffer, (err) => {
                        if (!err) {
                            ipcRenderer.send("clip_main_b", "ok_save", message);
                        }
                    });
                    break;
            }
        });
        tool.close();
    }
}
var svg;
/**
 * 获取选区图像
 * @param type 格式
 * @returns promise svg base64|canvas element
 */
function getClipPhoto(type: string) {
    var mainCtx = mainCanvas.getContext("2d");
    if (!finalRect) finalRect = [0, 0, mainCanvas.width, mainCanvas.height];

    if (typeof fabricCanvas != "undefined") {
        fabricCanvas.discardActiveObject();
        fabricCanvas.renderAll();
    }

    if (type == "svg") {
        svg = document.createElement("div");
        if (typeof fabricCanvas == "undefined") {
            svg.innerHTML = `<!--?xml version="1.0" encoding="UTF-8" standalone="no" ?-->
            <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${mainCanvas.width}" height="${mainCanvas.height}" viewBox="0 0 1920 1080" xml:space="preserve">
            <desc>Created with eSearch</desc>
            </svg>`;
        } else {
            svg.innerHTML = fabricCanvas.toSVG();
            svg.querySelector("desc").innerHTML = "Created with eSearch & Fabric.js";
        }
        svg.querySelector("svg").setAttribute("viewBox", finalRect.join(" "));
        let image = document.createElementNS("http://www.w3.org/2000/svg", "image");
        image.setAttribute("xlink:href", mainCanvas.toDataURL());
        svg.querySelector("svg").insertBefore(image, svg.querySelector("svg").firstChild);
        var svgT = new XMLSerializer().serializeToString(svg.querySelector("svg"));
        return new Promise((resolve, _rejects) => {
            resolve(svgT);
        });
    } else {
        var tmpCanvas = document.createElement("canvas");
        tmpCanvas.width = finalRect[2];
        tmpCanvas.height = finalRect[3];
        var gid = mainCtx.getImageData(finalRect[0], finalRect[1], finalRect[2], finalRect[3]); // 裁剪
        tmpCanvas.getContext("2d").putImageData(gid, 0, 0);
        let image = document.createElement("img");
        image.src = fabricCanvas.toDataURL({
            left: finalRect[0],
            top: finalRect[1],
            width: finalRect[2],
            height: finalRect[3],
            format: type,
        });
        return new Promise((resolve, _rejects) => {
            image.onload = () => {
                tmpCanvas.getContext("2d").drawImage(image, 0, 0, finalRect[2], finalRect[3]);
                if (!isRect) {
                    const ctx = tmpCanvas.getContext("2d");

                    // 创建临时Canvas并保存原始内容
                    const tempCanvas = createTemporaryCanvas(tmpCanvas);

                    // 清除主Canvas
                    ctx.clearRect(0, 0, tmpCanvas.width, tmpCanvas.height);

                    // 定义裁剪区域
                    ctx.beginPath();
                    freeSelect.forEach((point, index) => {
                        if (index === 0) {
                            ctx.moveTo(point.x - finalRect[0], point.y - finalRect[1]);
                        } else {
                            ctx.lineTo(point.x - finalRect[0], point.y - finalRect[1]);
                        }
                    });
                    ctx.closePath();
                    ctx.clip();

                    // 将原始内容重新绘制到主Canvas上
                    ctx.drawImage(tempCanvas, 0, 0);
                }
                resolve(tmpCanvas);
            };
        });
    }
}

function createTemporaryCanvas(originalCanvas: HTMLCanvasElement) {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = originalCanvas.width;
    tempCanvas.height = originalCanvas.height;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.drawImage(originalCanvas, 0, 0);
    return tempCanvas;
}

var toolPosition = { x: null, y: null };
toolBar.addEventListener("mousedown", (e) => {
    toolBar.style.transition = "none";
    if (e.button == 2) {
        toolPosition.x = e.clientX - toolBar.offsetLeft;
        toolPosition.y = e.clientY - toolBar.offsetTop;
    }
});
toolBar.addEventListener("mouseup", (e) => {
    toolBar.style.transition = "";
    if (e.button == 2) toolPosition = { x: null, y: null };
});

const loadingEl = document.getElementById("loading");
loadingEl.classList.add("loading_hide");
function showLoading(text: string) {
    loadingEl.innerText = text;
    loadingEl.classList.remove("loading_hide");
    loadingEl.style.left = `calc(50% - ${loadingEl.offsetWidth / 2}px)`;
    loadingEl.style.top = `calc(50% - ${loadingEl.offsetHeight / 2}px)`;
}

function hideLoading() {
    loadingEl.classList.add("loading_hide");
}

import { t, lan } from "../../../lib/translate/translate";
lan(store.get("语言.语言"));
document.title = t(document.title);

import Color from "color";

// 键盘控制光标
document.querySelector("body").onkeydown = (e) => {
    let tagName = (<HTMLElement>e.target).tagName;
    if ((<HTMLElement>e.target).isContentEditable || tagName == "INPUT" || tagName == "SELECT" || tagName == "TEXTAREA")
        return;
    if (longRunning) return;
    const o = {
        ArrowUp: "up",
        ArrowRight: "right",
        ArrowDown: "down",
        ArrowLeft: "left",
    };
    let v = 1;
    if (e.ctrlKey) v = v * 5;
    if (e.shiftKey) v = v * 10;
    if (o[e.key]) {
        if (down) {
            let op = nowMouseE;
            let x = op.offsetX,
                y = op.offsetY,
                d = v;
            switch (o[e.key]) {
                case "up":
                    y = op.offsetY - d;
                    break;
                case "down":
                    y = op.offsetY + d;
                    break;
                case "right":
                    x = op.offsetX + d;
                    break;
                case "left":
                    x = op.offsetX - d;
                    break;
            }
            moveRect(finalRect, { x: op.offsetX, y: op.offsetY }, { x, y });
        } else {
            let x = editorP.x,
                y = editorP.y,
                d = (10 * v) / editorP.zoom;
            switch (o[e.key]) {
                case "up":
                    y = editorP.y + d;
                    break;
                case "down":
                    y = editorP.y - d;
                    break;
                case "right":
                    x = editorP.x - d;
                    break;
                case "left":
                    x = editorP.x + d;
                    break;
            }
            setEditorP(editorP.zoom, x, y);
            document.body.classList.add("editor_bg");
            let cX = (nowMouseE.clientX - editorP.x * editorP.zoom) / editorP.zoom;
            let cY = (nowMouseE.clientY - editorP.y * editorP.zoom) / editorP.zoom;
            nowCanvasPosition = pXY2cXY(clipCanvas, cX, cY, cX, cY);
            mouseBar(finalRect, nowCanvasPosition[0], nowCanvasPosition[1]);
        }
    }
};
// 鼠标框选坐标转画布坐标,鼠标坐标转画布坐标
function pXY2cXY(canvas: HTMLCanvasElement, oX1: number, oY1: number, oX2: number, oY2: number): rect {
    // 0_零_1_一_2_二_3 阿拉伯数字为点坐标（canvas），汉字为像素坐标（html）
    // 输入为边框像素坐标
    // 为了让canvas获取全屏，边框像素点要包括
    // 像素坐标转为点坐标后,左和上(小的)是不变的,大的少1
    var x1 = Math.min(oX1, oX2);
    var y1 = Math.min(oY1, oY2);
    var x2 = Math.max(oX1, oX2) + 1;
    var y2 = Math.max(oY1, oY2) + 1;
    // canvas缩放变换
    x1 = Math.round(canvas.width * (x1 / canvas.offsetWidth));
    y1 = Math.round(canvas.height * (y1 / canvas.offsetHeight));
    x2 = Math.round(canvas.width * (x2 / canvas.offsetWidth));
    y2 = Math.round(canvas.height * (y2 / canvas.offsetHeight));
    return [x1, y1, x2 - x1, y2 - y1];
}

function pXY2cXY2(canvas: HTMLCanvasElement, oX1: number, oY1: number): point {
    // canvas缩放变换
    const x1 = Math.round(canvas.width * (oX1 / canvas.offsetWidth));
    const y1 = Math.round(canvas.height * (oY1 / canvas.offsetHeight));

    return { x: x1, y: y1 };
}

function pointsOutRect(points: point[]): rect {
    if (points.length === 0) {
        return null; // 如果点集为空，返回null
    }

    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;

    // 遍历所有点，找到最小和最大的x,y坐标
    for (const point of points) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
    }

    // 返回边框的左下角和右上角坐标
    return [minX, minY, maxX - minX, maxY - minY];
}

/** 矩形还是自由 */
var isRect = true;
var /**是否在绘制新选区*/ selecting = false;
var rightKey = false;
var canvasRect = null;
var /**是否在更改选区*/ moving = false;

type editor_position = { x: number; y: number };

var /** 先前坐标，用于框选的生成和调整 */ oldP = { x: NaN, y: NaN } as editor_position;
var oFinalRect = null as rect;
var oPoly = null as point[];
var theColor: [number, number, number, number] = null;
var theTextColor = [null, null];
var clipCtx = clipCanvas.getContext("2d");
var undoStack = [{ rect: 0, canvas: 0 }],
    rectStack = [[0, 0, mainCanvas.width, mainCanvas.height]] as rect[],
    canvasStack = [{}];
var undoStackI = 0;
var nowCanvasPosition: number[];
var direction: "" | "move" | "东" | "西" | "南" | "北" | "东南" | "西南" | "东北" | "西北";
var autoSelectRect = store.get("框选.自动框选.开启");
var autoPhotoSelectRect = store.get("框选.自动框选.图像识别");
var /**鼠标是否移动过，用于自动框选点击判断 */ moved = false;
var /**鼠标是否按住 */ down = false;
var /**是否选好了选区，若手动选好，自动框选提示关闭 */ rectSelect = false;

clipCanvas.onmousedown = (e) => {
    let inRect = false;
    if (isRect) {
        inRect = isInClipRect({ x: e.offsetX, y: e.offsetY });
    } else {
        inRect = isPointInPolygon({ x: e.offsetX, y: e.offsetY }, freeSelect);
    }
    if (e.button == 0) {
        clipStart({ x: e.offsetX, y: e.offsetY }, inRect);
    }
    if (e.button == 2) {
        pickColor({ x: e.offsetX, y: e.offsetY });
    }
    toolBar.style.pointerEvents =
        drawBar.style.pointerEvents =
        document.getElementById("clip_wh").style.pointerEvents =
            "none";

    down = true;
};

// 开始操纵框选
function clipStart(p: editor_position, inRect: boolean) {
    if (isRect) {
        // 在选区内，则调整，否则新建
        if (inRect) {
            isInClipRect(p);
            oldP = { x: p.x, y: p.y };
            oFinalRect = finalRect;
            moving = true;
            moveRect(oFinalRect, p, p);
        } else {
            selecting = true;
            canvasRect = [p.x, p.y]; // 用于框选
            finalRect = pXY2cXY(clipCanvas, canvasRect[0], canvasRect[1], p.x, p.y);
            rightKey = false;
            changeRightBar(false);
        }
    } else {
        if (inRect) {
            oldP = { x: p.x, y: p.y };
            oPoly = structuredClone(freeSelect);
            moving = true;
            movePoly(oPoly, p, p);
        } else {
            selecting = true;
            freeSelect = [p];
            finalRect = pointsOutRect(freeSelect);
            rightKey = false;
            changeRightBar(false);
        }
    }
    // 隐藏
    drawBar.style.opacity = toolBar.style.opacity = "0";
}

function pickColor(p: editor_position) {
    rightKey = rightKey ? false : true;
    // 自由右键取色
    nowCanvasPosition = pXY2cXY(clipCanvas, p.x, p.y, p.x, p.y);
    mouseBar(finalRect, nowCanvasPosition[0], nowCanvasPosition[1]);
    // 改成多格式样式
    if (rightKey) {
        changeRightBar(true);
    } else {
        changeRightBar(false);
    }
}

clipCanvas.onmousemove = (e) => {
    if (down) {
        moved = true;
        rectSelect = true; // 按下并移动，肯定手动选好选区了
    }

    if (e.button == 0) {
        requestAnimationFrame(() => {
            if (selecting) {
                if (isRect) {
                    // 画框
                    finalRect = pXY2cXY(clipCanvas, canvasRect[0], canvasRect[1], e.offsetX, e.offsetY);
                    drawClipRect();
                } else {
                    freeSelect.push(pXY2cXY2(clipCanvas, e.offsetX, e.offsetY));
                    finalRect = pointsOutRect(freeSelect);
                    // todo 化简多边形
                    drawClipPoly(freeSelect);
                }
            }
            if (moving) {
                if (isRect) {
                    moveRect(oFinalRect, oldP, { x: e.offsetX, y: e.offsetY });
                } else {
                    movePoly(oPoly, oldP, { x: e.offsetX, y: e.offsetY });
                }
            }
            if (down) mouseBar(finalRect, nowCanvasPosition[0], nowCanvasPosition[1]);
        });
    }
    if (!selecting && !moving) {
        // 只是悬浮光标时生效，防止在新建或调整选区时光标发生突变
        if (isRect) {
            isInClipRect({ x: e.offsetX, y: e.offsetY });
        } else {
            isPointInPolygon({ x: e.offsetX, y: e.offsetY }, freeSelect);
        }
    }

    if (autoSelectRect) {
        inEdge({ x: e.offsetX, y: e.offsetY });
    }
};

clipCanvas.onmouseup = (e) => {
    if (e.button == 0) {
        if (selecting) {
            clipEnd({ x: e.offsetX, y: e.offsetY });
            // 抬起鼠标后工具栏跟随
            followBar(e.clientX, e.clientY);
            // 框选后默认操作
            if (autoDo != "no" && e.button == 0) {
                tool[autoDo]();
            }
        }
        if (moving) {
            moving = false;
            oFinalRect = null;
            if (e.button == 0) followBar(e.clientX, e.clientY);
            hisPush();
        }
    }
    toolBar.style.pointerEvents =
        drawBar.style.pointerEvents =
        document.getElementById("clip_wh").style.pointerEvents =
            "auto";

    down = false;
    moved = false;
};

function clipEnd(p: editor_position) {
    clipCtx.closePath();
    selecting = false;
    nowCanvasPosition = pXY2cXY(clipCanvas, p.x, p.y, p.x, p.y);
    if (isRect) {
        if (!moved && down) {
            rectSelect = true;
            let min = [],
                minN = Infinity;
            for (let i of rectInRect) {
                if (i[2] * i[3] < minN) {
                    min = i;
                    minN = i[2] * i[3];
                }
            }
            if (min.length != 0) finalRect = min as rect;
            drawClipRect();
        } else {
            finalRect = pXY2cXY(clipCanvas, canvasRect[0], canvasRect[1], p.x, p.y);
            drawClipRect();
        }
    } else {
        freeSelect.push(pXY2cXY2(clipCanvas, p.x, p.y));
        finalRect = pointsOutRect(freeSelect);
        drawClipPoly(freeSelect);
    }
    hisPush();
}

/** 画框(遮罩) */
function drawClipRect() {
    const cw = clipCanvas.width;
    const ch = clipCanvas.height;

    clipCtx.clearRect(0, 0, cw, ch);
    clipCtx.beginPath();

    const x = finalRect[0];
    const y = finalRect[1];
    const width = finalRect[2];
    const height = finalRect[3];

    // 框选为黑色遮罩
    clipCtx.fillStyle = 遮罩颜色;

    const topMaskHeight = y;
    const leftMaskWidth = x;
    const rightMaskWidth = cw - (x + width);
    const bottomMaskHeight = ch - (y + height);

    clipCtx.fillRect(0, 0, cw, topMaskHeight);
    clipCtx.fillRect(0, y, leftMaskWidth, height);
    clipCtx.fillRect(x + width, y, rightMaskWidth, height);
    clipCtx.fillRect(0, y + height, cw, bottomMaskHeight);

    clipCtx.fillStyle = 选区颜色;
    clipCtx.fillRect(x, y, width, height);

    // 大小栏
    whBar(finalRect);
}

/** 画多边形(遮罩) */
function drawClipPoly(points: point[]) {
    let ctx = clipCtx;
    let canvas = clipCanvas;
    if (points.length < 2) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 遮罩颜色;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 创建内部镂空效果
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.fillStyle = "#fff";
    ctx.closePath();
    ctx.fill();

    // 恢复默认绘图模式
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.fillStyle = 选区颜色;
    ctx.closePath();
    ctx.fill();

    // 大小栏
    whBar(pointsOutRect(points));
}

var rectInRect = [];
/**
 * 自动框选提示
 */
function inEdge(p: editor_position) {
    if (rectSelect) return;
    console.log(1);

    rectInRect = [];
    for (const i of edgeRect) {
        let x0 = i.x,
            y0 = i.y,
            x1 = i.x + i.width,
            y1 = i.y + i.height;
        if (x0 < p.x && p.x < x1 && y0 < p.y && p.y < y1) {
            rectInRect.push([i.x, i.y, i.width, i.height]);
        }
    }
    clipCtx.clearRect(0, 0, clipCanvas.width, clipCanvas.height);
    clipCtx.beginPath();
    clipCtx.strokeStyle = "#000";
    clipCtx.lineWidth = 1;
    for (let i of rectInRect) {
        clipCtx.strokeRect(i[0], i[1], i[2], i[3]);
    }
}

hotkeys("s", () => {
    // 重新启用自动框选提示
    rectSelect = false;
    finalRect = [0, 0, clipCanvas.width, clipCanvas.height];
    drawClipRect();
});

var whEl = document.getElementById("clip_wh");
// 大小栏
function whBar(finalRect: rect) {
    // 大小文字
    if (四角坐标) {
        var x0, y0, x1, y1, d;
        d = 光标 == "以(1,1)为起点" ? 1 : 0;
        x0 = finalRect[0] + d;
        y0 = finalRect[1] + d;
        x1 = finalRect[0] + d + finalRect[2];
        y1 = finalRect[1] + d + finalRect[3];
        document.getElementById("x0y0").style.display = "block";
        document.getElementById("x1y1").style.display = "block";
        document.getElementById("x0y0").innerHTML = `${x0}, ${y0}`;
        document.getElementById("x1y1").innerHTML = `${x1}, ${y1}`;
    }
    document.querySelector("#wh").innerHTML = `${finalRect[2]} × ${finalRect[3]}`;
    // 位置
    let zx = (finalRect[0] + editorP.x) * editorP.zoom,
        zy = (finalRect[1] + editorP.y) * editorP.zoom,
        zw = finalRect[2] * editorP.zoom,
        zh = finalRect[3] * editorP.zoom;
    let dw = whEl.offsetWidth,
        dh = whEl.offsetHeight;
    let x: number;
    if (dw >= zw) {
        if (dw + zx <= window.innerWidth) {
            x = zx; // 对齐框的左边
            whEl.style.right = ``;
            whEl.style.left = `${x}px`;
        } else {
            whEl.style.left = ``;
            whEl.style.right = `0px`;
        }
    } else {
        x = zx + zw / 2 - dw / 2;
        if (x + dw <= window.innerWidth) {
            whEl.style.right = ``;
            whEl.style.left = `${x}px`;
        } else {
            whEl.style.left = ``;
            whEl.style.right = `0px`;
        }
    }
    let y: number;
    if (zy - (dh + 10) >= 0) {
        y = zy - (dh + 10); // 不超出时在外
    } else {
        if (zy + zh + 10 + dh <= window.innerHeight) {
            y = zy + zh + 10;
        } else {
            y = zy + 10;
        }
    }
    whEl.style.top = `${y}px`;
}

/**
 * 更改x0y0 x1y1 wh
 * @param {string} arg 要改的位置
 */
function 更改大小栏(arg: string) {
    var l = document.querySelector(`#${arg}`).innerHTML.split(/[,×]/);
    l = l.map((string) => {
        // 排除（数字运算符空格）之外的非法输入
        if (string.match(/[\d\+\-*/\.\s\(\)]/g).length != string.length) return null;
        return eval(string);
    });
    var d = 光标 == "以(1,1)为起点" ? 1 : 0;
    if (l != null) {
        switch (arg) {
            case "x0y0":
                finalRect[0] = Number(l[0]) - d;
                finalRect[1] = Number(l[1]) - d;
                break;
            case "x1y1":
                finalRect[0] = Number(l[0]) - finalRect[2] - d;
                finalRect[1] = Number(l[1]) - finalRect[3] - d;
                break;
            case "wh":
                finalRect[2] = Number(l[0]);
                finalRect[3] = Number(l[1]);
                break;
        }
        finalRectFix();
        hisPush();
        drawClipRect();
        followBar();
    } else {
        var innerHTML = null;
        switch (arg) {
            case "x0y0":
                innerHTML = `${finalRect[0] + d}, ${finalRect[1] + d}`;
                break;
            case "x1y1":
                innerHTML = `${finalRect[0] + d + finalRect[2]}, ${finalRect[1] + d + finalRect[3]}`;
                break;
            case "wh":
                innerHTML = `${finalRect[2]} × ${finalRect[3]}`;
                break;
        }
        document.querySelector(`#${arg}`).innerHTML = innerHTML;
    }
}
whEl.onkeydown = (e) => {
    if (e.key == "Enter") {
        e.preventDefault();
        更改大小栏((<HTMLElement>e.target).id);
    }
};
document.getElementById("x0y0").onblur = () => {
    更改大小栏("x0y0");
};
document.getElementById("x1y1").onblur = () => {
    更改大小栏("x1y1");
};
document.getElementById("wh").onblur = () => {
    更改大小栏("wh");
};

// 快捷键全屏选择
hotkeys("ctrl+a, command+a", () => {
    finalRect = [0, 0, mainCanvas.width, mainCanvas.height];
    hisPush();
    clipCanvas.style.cursor = "crosshair";
    direction = "";
    drawClipRect();
});

// 生成取色器
if (!取色器显示) document.getElementById("point_color").style.display = "none";

const pointColorCanvasBg = document.createElement("canvas");
pointColorCanvasBg.style.opacity = "0.5";
pointColorCanvasBg.width = pointColorCanvasBg.height = colorSize;
document.getElementById("point_color").append(pointColorCanvasBg);
const pointColorCanvasBgCtx = pointColorCanvasBg.getContext("2d");
const pointColorCanvas = document.createElement("canvas");
pointColorCanvas.width = pointColorCanvas.height = colorSize;
document.getElementById("point_color").append(pointColorCanvas);
const pointColorCanvasCtx = pointColorCanvas.getContext("2d");
const pointCenter = document.createElement("div");
document.getElementById("point_color").append(pointCenter);
pointCenter.style.left = ((colorSize - 1) / 2) * colorISize + "px";
pointCenter.style.top = ((colorSize - 1) / 2) * colorISize + "px";

var mouseBarW =
    Math.max(
        colorSize * colorISize,
        (String(window.innerWidth).length + String(window.innerHeight).length + 2 + 1) * 8
    ) + 4;
var mouseBarH = 4 + colorSize * colorISize + 32 * 2;

var mouseBarEl = document.getElementById("mouse_bar");
if (!store.get("鼠标跟随栏.显示")) mouseBarEl.style.display = "none";
// 鼠标跟随栏
const mainCanvasContext = mainCanvas.getContext("2d");

function mouseBar(finalRect: rect, x: number, y: number) {
    requestAnimationFrame(() => {
        const [x0, y0, width, height] = finalRect;

        const delta = (colorSize - 1) / 2;
        const xOffset = x - delta;
        const yOffset = y - delta;

        const centerIndex = (colorSize * delta + delta) * 4;

        const imageData = mainCanvasContext.getImageData(xOffset, yOffset, colorSize, colorSize);

        pointColorCanvasCtx.clearRect(0, 0, colorSize, colorSize);
        pointColorCanvasBgCtx.clearRect(0, 0, colorSize, colorSize);

        pointColorCanvasBgCtx.putImageData(imageData, 0, 0);

        let points = [];

        if (isRect || freeSelect.length < 3) {
            points.push({ x: x0, y: y0 });
            points.push({ x: x0, y: y0 + height });
            points.push({ x: x0 + width, y: y0 + height });
            points.push({ x: x0 + width, y: y0 });
        } else {
            points = freeSelect;
        }

        pointColorCanvasCtx.save();

        pointColorCanvasCtx.beginPath();
        pointColorCanvasCtx.moveTo(points[0].x - xOffset, points[0].y - yOffset);
        for (let i = 1; i < points.length; i++) {
            pointColorCanvasCtx.lineTo(points[i].x - xOffset, points[i].y - yOffset);
        }
        pointColorCanvasCtx.closePath();
        pointColorCanvasCtx.clip();
        pointColorCanvasCtx.drawImage(pointColorCanvasBg, 0, 0);

        pointColorCanvasCtx.restore();

        let [r, g, b, a] = imageData.data.slice(centerIndex, centerIndex + 4);

        a /= 255;
        pointCenter.style.background = `rgba(${r}, ${g}, ${b}, ${a})`;
        theColor = [r, g, b, a];
        clipColorText(theColor, 取色器默认格式);

        const d = 光标 === "以(1,1)为起点" ? 1 : 0;
        document.getElementById("clip_xy").innerText = `(${x + d}, ${y + d})`;
    });
}

// 复制坐标
document.getElementById("clip_xy").onclick = () => {
    copy(document.getElementById("clip_xy"));
};

// 色彩空间转换
function colorConversion(rgba: number[] | string, type: string): string {
    const color = new Color(rgba);
    if (color.alpha() !== 1) return "/";
    switch (type) {
        case "HEX":
            return color.hex();
        case "RGB":
            return color.rgb().string();
        case "HSL":
            const hsl = color.hsl().round().array();
            return `hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)`;
        case "HSV":
            const hsv = color.hsv().round().array();
            return `hsv(${hsv[0]}, ${hsv[1]}%, ${hsv[2]}%)`;
        case "CMYK":
            const cmyk = color.cmyk().round().array();
            return `cmyk(${cmyk[0]}, ${cmyk[1]}, ${cmyk[2]}, ${cmyk[3]})`;
        default:
            return "";
    }
}

// 改变颜色文字和样式
function clipColorText(l: typeof theColor, type: string) {
    let color = Color.rgb(l);
    let clipColorTextColor = color.alpha() == 1 ? (color.isLight() ? "#000" : "#fff") : "";
    theTextColor = [color.hexa(), clipColorTextColor];

    (<HTMLDivElement>document.querySelector(`#clip_copy > div > div:not(:nth-child(1))`)).style.backgroundColor =
        color.hexa();
    let mainEl = <HTMLElement>(
        document.querySelector(`#clip_copy > div > div:not(:nth-child(1)) > div:nth-child(${取色器格式位置})`)
    );
    // 只改变默认格式的字体颜色和内容，并定位展示
    mainEl.style.color = theTextColor[1];
    mainEl.innerText = colorConversion(theColor, type);
    if (color.alpha() != 1) {
        mainEl.style.color = "";
    }
    (<HTMLDivElement>document.querySelector("#clip_copy > div")).style.top = -32 * 取色器格式位置 + "px";
}

// 改变鼠标跟随栏形态，展示所有颜色格式
function changeRightBar(v) {
    // 拼接坐标和颜色代码
    let t = `<div>${finalRect[2]} × ${finalRect[3]}</div>`;
    t += `<div style="background-color:${theTextColor[0]};color:${theTextColor[1]}">`;
    for (let i in allColorFormat) {
        t += `<div>${colorConversion(theColor, allColorFormat[i])}</div>`;
    }
    document.querySelector("#clip_copy > div").innerHTML = t + "</div>";
    // 复制大小和颜色
    (<HTMLElement>document.querySelector("#clip_copy > div > div:nth-child(1)")).onclick = () => {
        copy(document.querySelector("#clip_copy > div > div:nth-child(1)"));
    };
    let nodes = document.querySelectorAll("#clip_copy > div > div:not(:nth-child(1)) > div");
    nodes.forEach((element: HTMLElement) => {
        ((e) => {
            e.onclick = () => {
                copy(e);
            };
        })(element);
    });
    if (v) {
        document.getElementById("point_color").style.height = "0";
        document.getElementById("clip_copy").className = "clip_copy";
        document.getElementById("mouse_bar").style.pointerEvents = "auto";
    } else {
        document.getElementById("clip_copy").className = "clip_copy_h";
        document.getElementById("point_color").style.height = "";
        document.getElementById("mouse_bar").style.pointerEvents = "none";
    }
}
changeRightBar(false);

/**
 * 复制内容
 * @param e 要复制内容的元素
 */
function copy(e: HTMLElement) {
    clipboard.writeText(e.innerText);
    rightKey = false;
    changeRightBar(false);
}

hotkeys(store.get("其他快捷键.复制颜色"), () => {
    copy(document.querySelector(`#clip_copy > div > div:not(:nth-child(1)) > div:nth-child(${取色器格式位置})`));
});

clipCanvas.ondblclick = () => {
    tool.copy();
};

// 鼠标栏实时跟踪
document.onmousemove = (e) => {
    if (!rightKey) {
        if (clipCanvas.offsetWidth != 0) {
            // 鼠标位置文字
            const cX = (e.clientX - editorP.x * editorP.zoom) / editorP.zoom;
            const cY = (e.clientY - editorP.y * editorP.zoom) / editorP.zoom;
            nowCanvasPosition = pXY2cXY(clipCanvas, cX, cY, cX, cY);
            // 鼠标跟随栏
            if (!down) mouseBar(finalRect, nowCanvasPosition[0], nowCanvasPosition[1]);
        }
        // 鼠标跟随栏

        const d = 16;
        const x = e.clientX + d;
        const y = e.clientY + d;
        const w = mouseBarW;
        const h = mouseBarH;
        const sw = window.innerWidth;
        const sh = window.innerHeight;

        mouseBarEl.style.left = `${Math.min(x, sw - w - d)}px`;
        mouseBarEl.style.top = `${Math.min(y, sh - h - d)}px`;

        const isDrawBar = drawBar.contains(e.target as HTMLElement);
        const isToolBar = toolBar.contains(e.target as HTMLElement);
        mouseBarEl.classList.toggle("mouse_bar_hide", isDrawBar || isToolBar);

        // 画板栏移动
        if (drawBarMoving) {
            drawBar.style.left = `${e.clientX - drawBarMovingXY[0]}px`;
            drawBar.style.top = `${e.clientY - drawBarMovingXY[1]}px`;
        }
    }
    if (toolPosition.x) {
        toolBar.style.left = `${e.clientX - toolPosition.x}px`;
        toolBar.style.top = `${e.clientY - toolPosition.y}px`;
        trackLocation();
    }
};

// 工具栏跟随
var followBarList = [[0, 0]];
var drawBarPosi: "right" | "left" = "right";
const barGap = 8;
/**
 * 工具栏自动跟随
 * @param x x坐标
 * @param y y坐标
 */
function followBar(x?: number, y?: number) {
    let zx = (finalRect[0] + editorP.x) * editorP.zoom,
        zy = (finalRect[1] + editorP.y) * editorP.zoom,
        zw = finalRect[2] * editorP.zoom,
        zh = finalRect[3] * editorP.zoom;
    if (!x && !y) {
        var dx = undoStack.at(-1)[0] - undoStack[undoStack.length - 2][0];
        var dy = undoStack.at(-1)[1] - undoStack[undoStack.length - 2][1];
        x = followBarList.at(-1)[0] + dx / ratio;
        y = followBarList.at(-1)[1] + dy / ratio;
    }
    followBarList.push([x, y]);
    let [x1, y1] = [zx, zy];
    let x2 = x1 + zw;
    let y2 = y1 + zh;
    let maxWidth = window.innerWidth;
    let maxHeight = window.innerHeight;
    const toolW = toolBar.offsetWidth;
    const drawW = drawBar.offsetWidth;
    const gap = barGap;
    let groupW = toolW + gap + drawW;

    if ((x1 + x2) / 2 <= x) {
        // 向右
        if (x2 + groupW + gap <= maxWidth) {
            toolBar.style.left = x2 + gap + "px"; // 贴右边
            drawBarPosi = "right";
        } else {
            if (工具栏跟随 == "展示内容优先") {
                // 超出屏幕贴左边
                if (x1 - groupW - gap >= 0) {
                    toolBar.style.left = x1 - toolW - gap + "px";
                    drawBarPosi = "left";
                } else {
                    // 还超贴右内
                    toolBar.style.left = maxWidth - groupW + "px";
                    drawBarPosi = "right";
                }
            } else {
                // 直接贴右边,即使遮挡
                toolBar.style.left = x2 - groupW - gap + "px";
                drawBarPosi = "right";
            }
        }
    } else {
        // 向左
        if (x1 - groupW - gap >= 0) {
            toolBar.style.left = x1 - toolW - gap + "px"; // 贴左边
            drawBarPosi = "left";
        } else {
            if (工具栏跟随 == "展示内容优先") {
                // 超出屏幕贴右边
                if (x2 + groupW <= maxWidth) {
                    toolBar.style.left = x2 + gap + "px";
                    drawBarPosi = "right";
                } else {
                    // 还超贴左内
                    toolBar.style.left = 0 + drawW + gap + "px";
                    drawBarPosi = "left";
                }
            } else {
                toolBar.style.left = x1 + gap + "px";
                drawBarPosi = "left";
            }
        }
    }

    if (y >= (y1 + y2) / 2) {
        if (y2 - toolBar.offsetHeight >= 0) {
            toolBar.style.top = y2 - toolBar.offsetHeight + "px";
        } else {
            if (y1 + toolBar.offsetHeight > maxHeight) {
                toolBar.style.top = maxHeight - toolBar.offsetHeight + "px";
            } else {
                toolBar.style.top = y1 + "px";
            }
        }
    } else {
        if (y1 + toolBar.offsetHeight <= maxHeight) {
            toolBar.style.top = y1 + "px";
        } else {
            toolBar.style.top = maxHeight - toolBar.offsetHeight + "px";
        }
    }
    drawBar.style.opacity = toolBar.style.opacity = "1";
    trackLocation();
}

// 移动画画栏
var drawBarMoving = false;
var drawBarMovingXY = [];
document.getElementById("draw_bar").addEventListener("mousedown", (e) => {
    if (e.button != 0) {
        drawBarMoving = true;
        drawBarMovingXY[0] = e.clientX - document.getElementById("draw_bar").offsetLeft;
        drawBarMovingXY[1] = e.clientY - document.getElementById("draw_bar").offsetTop;
        drawBar.style.transition = "0s";
    }
});
document.getElementById("draw_bar").addEventListener("mouseup", (e) => {
    if (e.button != 0) {
        drawBarMoving = false;
        drawBarMovingXY = [];
        drawBar.style.transition = "";
    }
});

// 修复final_rect负数
// 超出屏幕处理
function finalRectFix() {
    finalRect = finalRect.map((i) => Math.round(i)) as rect;
    var x0 = finalRect[0];
    var y0 = finalRect[1];
    var x1 = finalRect[0] + finalRect[2];
    var y1 = finalRect[1] + finalRect[3];
    var x = Math.min(x0, x1),
        y = Math.min(y0, y1);
    var w = Math.max(x0, x1) - x,
        h = Math.max(y0, y1) - y;
    // 移出去移回来保持原来大小
    if (x < 0) w = x = 0;
    if (y < 0) h = y = 0;
    if (x > mainCanvas.width) x = x % mainCanvas.width;
    if (y > mainCanvas.height) y = y % mainCanvas.height;
    if (x + w > mainCanvas.width) w = mainCanvas.width - x;
    if (y + h > mainCanvas.height) h = mainCanvas.height - y;
    finalRect = [x, y, w, h];
}

function inRange(min: number, value: number, max: number, type?: "[]" | "()" | "(]" | "[)") {
    if (!type) type = "[]";
    if (type === "[]") return min <= value && value <= max;
    else if (type === "(]") return min < value && value <= max;
    else if (type === "[)") return min <= value && value < max;
    else return min < value && value < max;
}

/**
 * 判断光标位置并更改样式,定义光标位置的移动方向
 */
function isInClipRect(p: editor_position) {
    let inRect = false;
    const [canvasX, canvasY] = pXY2cXY(clipCanvas, p.x, p.y, p.x, p.y);
    p.x = canvasX;
    p.y = canvasY;

    const [x0, y0, width, height] = finalRect;
    const x1 = x0 + width;
    const y1 = y0 + height;
    // 如果全屏,那允许框选
    if (!(finalRect[2] == mainCanvas.width && finalRect[3] == mainCanvas.height)) {
        if (x0 <= p.x && p.x <= x1 && y0 <= p.y && p.y <= y1) {
            // 在框选区域内,不可框选,只可调整
            inRect = true;
        } else {
            inRect = false;
        }

        direction = "";

        const num = 8;

        // 光标样式
        if (inRange(x0, p.x, x0 + num) && inRange(y0, p.y, y0 + num)) {
            clipCanvas.style.cursor = "nwse-resize";
            direction = "西北";
        } else if (inRange(x1 - num, p.x, x1) && inRange(y1 - num, p.y, y1)) {
            clipCanvas.style.cursor = "nwse-resize";
            direction = "东南";
        } else if (inRange(y0, p.y, y0 + num) && inRange(x1 - num, p.x, x1)) {
            clipCanvas.style.cursor = "nesw-resize";
            direction = "东北";
        } else if (inRange(y1 - num, p.y, y1) && inRange(x0, p.x, x0 + num)) {
            clipCanvas.style.cursor = "nesw-resize";
            direction = "西南";
        } else if (inRange(x0, p.x, x0 + num) && inRange(y0, p.y, y1)) {
            clipCanvas.style.cursor = "ew-resize";
            direction = "西";
        } else if (inRange(x1 - num, p.x, x1) && inRange(y0, p.y, y1)) {
            clipCanvas.style.cursor = "ew-resize";
            direction = "东";
        } else if (inRange(y0, p.y, y0 + num) && inRange(x0, p.x, x1)) {
            clipCanvas.style.cursor = "ns-resize";
            direction = "北";
        } else if (inRange(y1 - num, p.y, y1) && inRange(x0, p.x, x1)) {
            clipCanvas.style.cursor = "ns-resize";
            direction = "南";
        } else if (inRange(x0 + num, p.x, x1 - num, "()") && inRange(y0 + num, p.y, y1 - num, "()")) {
            clipCanvas.style.cursor = "move";
            direction = "move";
        } else {
            clipCanvas.style.cursor = "crosshair";
            direction = "";
        }
    } else {
        // 全屏可框选
        clipCanvas.style.cursor = "crosshair";
        direction = "";
        inRect = false;
    }
    return inRect;
}

/** 调整框选 */
function moveRect(oldFinalRect: rect, oldPosition: editor_position, position: editor_position) {
    var op = pXY2cXY(clipCanvas, oldPosition.x, oldPosition.y, oldPosition.x, oldPosition.y);
    var p = pXY2cXY(clipCanvas, position.x, position.y, position.x, position.y);
    var dx = p[0] - op[0],
        dy = p[1] - op[1];
    switch (direction) {
        case "西北":
            finalRect = [oldFinalRect[0] + dx, oldFinalRect[1] + dy, oldFinalRect[2] - dx, oldFinalRect[3] - dy];
            break;
        case "东南":
            finalRect = [oldFinalRect[0], oldFinalRect[1], oldFinalRect[2] + dx, oldFinalRect[3] + dy];
            break;
        case "东北":
            finalRect = [oldFinalRect[0], oldFinalRect[1] + dy, oldFinalRect[2] + dx, oldFinalRect[3] - dy];
            break;
        case "西南":
            finalRect = [oldFinalRect[0] + dx, oldFinalRect[1], oldFinalRect[2] - dx, oldFinalRect[3] + dy];
            break;
        case "西":
            finalRect = [oldFinalRect[0] + dx, oldFinalRect[1], oldFinalRect[2] - dx, oldFinalRect[3]];
            break;
        case "东":
            finalRect = [oldFinalRect[0], oldFinalRect[1], oldFinalRect[2] + dx, oldFinalRect[3]];
            break;
        case "北":
            finalRect = [oldFinalRect[0], oldFinalRect[1] + dy, oldFinalRect[2], oldFinalRect[3] - dy];
            break;
        case "南":
            finalRect = [oldFinalRect[0], oldFinalRect[1], oldFinalRect[2], oldFinalRect[3] + dy];
            break;
        case "move":
            finalRect = [oldFinalRect[0] + dx, oldFinalRect[1] + dy, oldFinalRect[2], oldFinalRect[3]];
            break;
    }
    if (finalRect[0] < 0) {
        finalRect[2] = finalRect[2] + finalRect[0];
        finalRect[0] = 0;
    }
    if (finalRect[1] < 0) {
        finalRect[3] = finalRect[3] + finalRect[1];
        finalRect[1] = 0;
    }
    if (finalRect[0] + finalRect[2] > mainCanvas.width) finalRect[2] = mainCanvas.width - finalRect[0];
    if (finalRect[1] + finalRect[3] > mainCanvas.height) finalRect[3] = mainCanvas.height - finalRect[1];

    finalRectFix();
    drawClipRect();
}
function isPointInPolygon(p: point, polygon: point[]): boolean {
    let inside = false;
    const n = polygon.length;
    if (n < 3) return false; // 多边形至少需要3个顶点

    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygon[i].x,
            yi = polygon[i].y;
        const xj = polygon[j].x,
            yj = polygon[j].y;

        // 检查点P的Y坐标是否在边ij的Y坐标范围内
        const intersect = yi > p.y != yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }
    if (inside) {
        clipCanvas.style.cursor = "move";
        direction = "move";
    } else {
        clipCanvas.style.cursor = "crosshair";
        direction = "";
    }
    return inside;
}

/** 调整框选 */
function movePoly(oldPoly: point[], oldPosition: editor_position, position: editor_position) {
    const op = pXY2cXY2(clipCanvas, oldPosition.x, oldPosition.y);
    const p = pXY2cXY2(clipCanvas, position.x, position.y);
    const dx = p.x - op.x,
        dy = p.y - op.y;
    if (direction === "move") {
        freeSelect = oldPoly.map((i) => {
            let x = Math.round(i.x + dx);
            let y = Math.round(i.y + dy);
            return { x, y };
        });

        drawClipPoly(freeSelect);
    }
}

document.getElementById("draw_select_rect").onclick = () => {
    setEditType("select", "rect");
};
document.getElementById("draw_select_free").onclick = () => {
    setEditType("select", "free");
};
document.getElementById("draw_select_draw").onclick = () => {
    setEditType("select", "draw");
};

/**
 * 保存历史
 */
function hisPush() {
    // 撤回到中途编辑，复制撤回的这一位置参数与编辑的参数一起放到末尾
    if (undoStackI != undoStack.length - 1 && undoStack.length >= 2) undoStack.push(undoStack[undoStackI]);

    let finalRectV = [finalRect[0], finalRect[1], finalRect[2], finalRect[3]] as rect; // 防止引用源地址导致后续操作-2个被改变
    let canvas = fabricCanvas?.toJSON() || {};

    if (rectStack.at(-1) + "" != finalRectV + "") rectStack.push(finalRectV);
    if (JSON.stringify(canvasStack.at(-1)) != JSON.stringify(canvas)) canvasStack.push(canvas);

    undoStack.push({ rect: rectStack.length - 1, canvas: canvasStack.length - 1 });
    undoStackI = undoStack.length - 1;
}
/**
 * 更改历史指针
 * @param {boolean} v true向前 false向后
 */
function undo(v: boolean) {
    if (v) {
        if (undoStackI > 0) {
            undoStackI--;
        }
    } else {
        if (undoStackI < undoStack.length - 1) {
            undoStackI++;
        }
    }
    var c = undoStack[undoStackI];
    finalRect = rectStack[c.rect];
    drawClipRect();
    followBar();
    if (fabricCanvas) fabricCanvas.loadFromJSON(canvasStack[c.canvas]);
}

hotkeys("ctrl+z", "normal", () => {
    undo(true);
});
hotkeys("ctrl+y", "normal", () => {
    undo(false);
});

document.getElementById("操作_撤回").onclick = () => {
    undo(true);
};
document.getElementById("操作_重做").onclick = () => {
    undo(false);
};
document.getElementById("操作_复制").onclick = () => {
    fabricCopy();
};
document.getElementById("操作_删除").onclick = () => {
    fabricDelete();
};

import fabricSrc from "../../../lib/fabric.min.js?raw";
let fabricEl = document.createElement("script");
fabricEl.innerHTML = fabricSrc;
document.body.append(fabricEl);
// @ts-ignore
Fabric = window.fabric;
var Fabric;

var fabricCanvas = new Fabric.Canvas("draw_photo");

let nowType: keyof EditType;
nowType = "select";
let editType: EditType = {
    select: "rect",
    draw: "free",
    filter: "",
    shape: "rect",
};
// todo 记忆

function setEditType<T extends keyof EditType>(mainType: T, type: EditType[T]): void {
    nowType = mainType;
    editType[mainType] = type;

    const SELECT = "select";

    for (let i in drawMainEls) {
        if (i === mainType) {
            drawMainEls[mainType].classList.add(SELECT);
            if (mainType != "filter") drawMainEls[mainType].innerHTML = drawSideEls[mainType][type].innerHTML;
        } else {
            drawMainEls[i]?.classList?.remove(SELECT);
        }
        for (let j in drawSideEls[i]) {
            if (i === mainType && j === type) {
                drawSideEls[i][j]?.classList?.add(SELECT);
            } else {
                drawSideEls[i][j]?.classList?.remove(SELECT);
            }
        }
    }

    if (mainType === "select") {
        if (type != "draw") {
            exitFree();
            exitShape();
            exitFilter();
            hotkeys.setScope("normal");
            drawM(false);
            if (type === "free") {
                isRect = false;
            } else {
                isRect = true;
            }
        } else {
            drawM(true);
            exitFree();
            exitShape();
            exitFilter();
        }
    } else {
        drawM(true);
    }
    if (mainType === "draw") {
        fabricCanvas.isDrawingMode = true;
        mode = type as EditType["draw"];
        freeInit();
        if (type === "free") {
            pencilElClick();
        }
        if (type === "eraser") {
            eraserElClick();
        }
        if (type === "spray") {
            freeSprayElClick();
        }
        exitShape();
        exitFilter();
        freeDrawCursor();
        ableChangeColor();
    }
    if (mainType === "filter") {
    }
    if (mainType === "shape") {
        shape = type as shape;
        if (store.get(`图像编辑.形状属性.${shape}`)) {
            let f = store.get(`图像编辑.形状属性.${shape}.fc`);
            let s = store.get(`图像编辑.形状属性.${shape}.sc`);
            let op = {};
            if (f) {
                op["fill"] = f;
                fillColor = f;
            }
            if (s) {
                op["stroke"] = s;
                strokeColor = s;
            }
            changeColor(op, false, true);
            let sw = store.get(`图像编辑.形状属性.${shape}.sw`);
            if (sw) {
                strokeWidth = sw;
                (<HTMLInputElement>document.querySelector("#draw_stroke_width > range-b")).value = sw;
            }
        }

        exitFree();
        exitFilter();
        fabricCanvas.defaultCursor = "crosshair";
        hotkeys.setScope("drawing_esc");

        store.set("图像编辑.记忆.形状", shape);

        ableChangeColor();
    }
}

hisPush();

var fillColor = store.get("图像编辑.默认属性.填充颜色");
var strokeColor = store.get("图像编辑.默认属性.边框颜色");
var strokeWidth = store.get("图像编辑.默认属性.边框宽度");
var freeColor = store.get("图像编辑.默认属性.画笔颜色");
var freeWidth = store.get("图像编辑.默认属性.画笔粗细");
var shadowBlur = 0;

// 编辑栏
const drawMainBar = document.getElementById("draw_main");
const drawSideBar = document.getElementById("draw_side");
showSideBar(false);
document.querySelectorAll("#draw_main > div").forEach((e: HTMLDivElement & { show: boolean }, index) => {
    // (<HTMLElement>document.querySelectorAll("#draw_side > div")[index]).style.height = "0";
    let ids = ["draw_select", "draw_free", "draw_shapes", "draw_filters", "draw_color", "draw_position", "draw_操作"];
    let sises = [1, 1, 2, 3, 1, 1, 1];
    let Type: (keyof EditType)[] = ["select", "draw", "shape", "filter"];
    e.addEventListener("mouseenter", () => {
        document.querySelectorAll("#draw_side > div").forEach((el: HTMLElement, i) => {
            showSideBar(true);
            if (index === i) {
                el.style.display = "";
                let height = Math.ceil(el.children.length / sises[index]);
                let x = sises[index];
                let y = height;
                el.style.width = x * bSize + "px";
                let left = bSize * 1;
                if (drawBar.offsetLeft + bSize + bSize * x > window.innerWidth) left = -bSize * x;
                drawSideBar.style.left = left + "px";
                drawSideBar.style.top = bSize * Math.min(i, drawMainBar.children.length - y) + "px";
                drawSideBar.style.width = bSize * x + "px";
                drawSideBar.style.height = bSize * y + "px";
            } else {
                el.style.display = "none";
            }
        });
    });
    e.addEventListener("click", () => {
        setEditType(Type[index], editType[Type[index]]);
    });
});

drawBar.onpointerleave = () => {
    showSideBar(false);
};

function showSideBar(show: boolean) {
    if (show) {
        drawSideBar.classList.remove("draw_side_hide");
    } else {
        drawSideBar.classList.add("draw_side_hide");
    }
}

var mode: EditType["draw"];

// 笔
drawSideEls.draw.free.onclick = () => setEditType("draw", "free");
// 橡皮
drawSideEls.draw.eraser.onclick = () => setEditType("draw", "eraser");
// 刷
drawSideEls.draw.spray.onclick = () => setEditType("draw", "spray");
function pencilElClick() {
    fabricCanvas.freeDrawingBrush = new Fabric.PencilBrush(fabricCanvas);
    fabricCanvas.freeDrawingBrush.color = freeColor;
    fabricCanvas.freeDrawingBrush.width = freeWidth;

    colorM = "stroke";
    setDrawMode(colorM);

    freeShadow();
}
function eraserElClick() {
    fabricCanvas.freeDrawingBrush = new Fabric.EraserBrush(fabricCanvas);
    fabricCanvas.freeDrawingBrush.width = freeWidth;
}
function freeSprayElClick() {
    fabricCanvas.freeDrawingBrush = new Fabric.SprayBrush(fabricCanvas);
    fabricCanvas.freeDrawingBrush.color = freeColor;
    fabricCanvas.freeDrawingBrush.width = freeWidth;

    colorM = "stroke";
    setDrawMode(colorM);
}
// 阴影
(<HTMLInputElement>document.querySelector("#shadow_blur > range-b")).oninput = freeShadow;

function freeShadow() {
    shadowBlur = Number((<HTMLInputElement>document.querySelector("#shadow_blur > range-b")).value);
    fabricCanvas.freeDrawingBrush.shadow = new Fabric.Shadow({
        blur: shadowBlur,
        color: freeColor,
    });
    store.set(`图像编辑.形状属性.${mode}.shadow`, shadowBlur);
}

function freeDrawCursor() {
    if (mode == "free" || mode == "eraser") {
        var svgW = freeWidth,
            hW = svgW / 2,
            r = freeWidth / 2;
        if (svgW < 10) {
            svgW = 10;
            hW = 5;
        }
        if (mode == "free") {
            var svg = `<svg width="${svgW}" height="${svgW}" xmlns="http://www.w3.org/2000/svg"><line x1="0" x2="${svgW}" y1="${hW}" y2="${hW}" stroke="#000"/><line y1="0" y2="${svgW}" x1="${hW}" x2="${hW}" stroke="#000"/><circle style="fill:${freeColor};" cx="${hW}" cy="${hW}" r="${r}"/></svg>`;
        } else {
            var svg = `<svg width="${svgW}" height="${svgW}" xmlns="http://www.w3.org/2000/svg"><line x1="0" x2="${svgW}" y1="${hW}" y2="${hW}" stroke="#000"/><line y1="0" y2="${svgW}" x1="${hW}" x2="${hW}" stroke="#000"/><circle style="stroke-width:1;stroke:#000;fill:none" cx="${hW}" cy="${hW}" r="${r}"/></svg>`;
        }
        var d = document.createElement("div");
        d.innerHTML = svg;
        var s = new XMLSerializer().serializeToString(d.querySelector("svg"));
        var cursorUrl = `data:image/svg+xml;base64,` + window.btoa(s);
        fabricCanvas.freeDrawingCursor = `url(" ${cursorUrl} ") ${hW} ${hW}, auto`;
    } else {
        fabricCanvas.freeDrawingCursor = `auto`;
    }
}

function freeInit() {
    let sc = store.get(`图像编辑.形状属性.${mode}.sc`);
    let sw = store.get(`图像编辑.形状属性.${mode}.sw`);
    let sb = store.get(`图像编辑.形状属性.${mode}.shadow`);
    if (sc) freeColor = sc;
    if (sw) freeWidth = sw;
    if (sb) shadowBlur = sb;
    if (sc) changeColor({ stroke: sc }, false, true);
    if (sw) (<HTMLInputElement>document.querySelector("#draw_stroke_width > range-b")).value = sw;
    if (sb) (<HTMLInputElement>document.querySelector("#shadow_blur > range-b")).value = sb;

    store.set("图像编辑.记忆.画笔", mode);
}

// 几何
type shape = EditType["shape"] | "";
var shape: shape = "";
document.getElementById("draw_shapes_i").onclick = (e) => {
    let el = e.target as HTMLElement;
    if (el.id.startsWith("draw_shapes_")) {
        let shape = el.id.replace("draw_shapes_", "") as EditType["shape"];
        setEditType("shape", shape);
    } else {
        return;
    }
};
// 层叠位置
document.getElementById("draw_position_i").onclick = (e) => {
    switch ((<HTMLElement>e.target).id) {
        case "draw_position_front":
            fabricCanvas.getActiveObject().bringToFront();
            break;
        case "draw_position_forwards":
            fabricCanvas.getActiveObject().bringForward();
            break;
        case "draw_position_backwards":
            fabricCanvas.getActiveObject().sendBackwards();
            break;
        case "draw_position_back":
            fabricCanvas.getActiveObject().sendToBack();
            break;
    }
};

// 删除快捷键
hotkeys("delete", fabricDelete);
function fabricDelete() {
    for (let o of fabricCanvas.getActiveObject()._objects || [fabricCanvas.getActiveObject()]) {
        fabricCanvas.remove(o);
    }
    getFObjectV();
    getFilters();
    hisPush();
}

var drawingShape = false;
var shapes = [];
var unnormalShapes = ["polyline", "polygon", "number"];
var drawOP = []; // 首次按下的点
var polyOP = []; // 多边形点
var newFilterO = null;
var drawNumberN = 1;

fabricCanvas.on("mouse:down", (options) => {
    // 非常规状态下点击
    if (shape != "" && (!options.target || options.target.length === 0)) {
        drawingShape = true;
        fabricCanvas.selection = false;
        // 折线与多边形要多次点击，在poly_o_p存储点
        if (!unnormalShapes.includes(shape)) {
            drawOP = [options.e.offsetX, options.e.offsetY];
            draw(shape, "start", drawOP[0], drawOP[1], options.e.offsetX, options.e.offsetY);
        } else {
            // 定义最后一个点,双击,点重复,结束
            var polyOPL = polyOP.at(-1);
            if (!(options.e.offsetX == polyOPL?.x && options.e.offsetY == polyOPL?.y)) {
                polyOP.push({ x: options.e.offsetX, y: options.e.offsetY });
                if (shape == "number") {
                    drawNumber();
                } else {
                    drawPoly(shape);
                }
            } else {
                hisPush();
                polyOP = [];
                drawNumberN = 1;
            }
        }
    }

    if (newFilterSelecting) {
        newFilterO = fabricCanvas.getPointer(options.e);
    }
});
fabricCanvas.on("mouse:move", (options) => {
    if (drawingShape) {
        if (!unnormalShapes.includes(shape)) {
            draw(shape, "move", drawOP[0], drawOP[1], options.e.offsetX, options.e.offsetY);
        }
    }
});
fabricCanvas.on("mouse:up", (options) => {
    if (!unnormalShapes.includes(shape)) {
        drawingShape = false;
        if (shape != "") {
            fabricCanvas.setActiveObject(shapes.at(-1));
            hisPush();
        }
    }

    getFObjectV();
    getFilters();

    if (newFilterSelecting) {
        newFilterSelect(newFilterO, fabricCanvas.getPointer(options.e));
        newFilterSelecting = false;
        (<HTMLInputElement>(<HTMLInputElement>document.querySelector("#draw_filters_select > lock-b"))).checked = false;
        fabricCanvas.defaultCursor = "auto";
        getFilters();
        hisPush();
        hotkeys.setScope("normal");
    }

    if (fabricCanvas.isDrawingMode) {
        hisPush();
    }
});

// 画一般图形
function draw(shape, v, x1, y1, x2, y2) {
    if (v == "move") {
        fabricCanvas.remove(shapes.at(-1));
        shapes.splice(shapes.length - 1, 1);
    }
    let x = Math.min(x1, x2),
        y = Math.min(y1, y2),
        w = Math.abs(x1 - x2),
        h = Math.abs(y1 - y2);
    switch (shape) {
        case "line":
            shapes[shapes.length] = new Fabric.Line([x1, y1, x2, y2], {
                stroke: strokeColor,
                形状: "line",
            });
            break;
        case "circle":
            shapes[shapes.length] = new Fabric.Circle({
                radius: Math.max(w, h) / 2,
                left: x,
                top: y,
                fill: fillColor,
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                canChangeFill: true,
                形状: "circle",
            });
            break;
        case "rect":
            shapes[shapes.length] = new Fabric.Rect({
                left: x,
                top: y,
                width: w,
                height: h,
                fill: fillColor,
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                canChangeFill: true,
                形状: "rect",
            });
            break;
        case "text":
            shapes.push(
                new Fabric.IText("点击输入文字", {
                    left: x,
                    top: y,
                    canChangeFill: true,
                    形状: "text",
                })
            );
            break;
        case "arrow":
            let line = new Fabric.Line([x1, y1, x2, y2], {
                stroke: strokeColor,
            });
            let t = new Fabric.Triangle({
                width: 20,
                height: 25,
                fill: strokeColor,
                left: x2,
                top: y2,
                originX: "center",
                angle: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90,
            });
            shapes.push(new Fabric.Group([line, t]));
            break;
        default:
            break;
    }
    fabricCanvas.add(shapes.at(-1));
}
// 多边形
function drawPoly(shape) {
    console.log(1111);

    if (polyOP.length != 1) {
        fabricCanvas.remove(shapes.at(-1));
        shapes.splice(shapes.length - 1, 1);
    }
    if (shape == "polyline") {
        shapes.push(
            new Fabric.Polyline(polyOP, {
                fill: "#0000",
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                形状: "polyline",
            })
        );
    }
    if (shape == "polygon") {
        shapes.push(
            new Fabric.Polygon(polyOP, {
                fill: fillColor,
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                canChangeFill: true,
                形状: "polygon",
            })
        );
    }
    fabricCanvas.add(shapes.at(-1));
}

function drawNumber() {
    drawNumberN = Number(shapes?.at(-1)?.text) + 1 || drawNumberN;
    let p = polyOP.at(-1);

    let txt = new Fabric.IText(String(drawNumberN), {
        left: p.x,
        top: p.y,
        fontSize: 16,
        originX: "center",
        originY: "center",
        canChangeFill: true,
    });
    let cr = new Fabric.Circle({
        radius: 10,
        left: p.x,
        top: p.y,
        originX: "center",
        originY: "center",
        fill: fillColor,
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        canChangeFill: true,
    });
    shapes.push(cr);
    shapes.push(txt);
    fabricCanvas.add(shapes.at(-2));
    fabricCanvas.add(shapes.at(-1));
    fabricCanvas.setActiveObject(txt);
    txt.enterEditing();

    drawNumberN++;
}

// 颜色选择

/** 规定当前色盘对应的是填充还是边框 */
var colorM: "fill" | "stroke" = "fill";
var colorFillEl = document.getElementById("draw_color_fill");
var colorStrokeEl = document.getElementById("draw_color_stroke");

setDrawMode(colorM);
document.getElementById("draw_color_switch").onclick = () => {
    if (colorM == "fill") {
        colorM = "stroke";
    } else {
        colorM = "fill";
    }
    setDrawMode(colorM);
};
/** 切换当前颜色设定的ui */
function setDrawMode(m: typeof colorM) {
    if (m == "fill") {
        document.getElementById("draw_fill").style.height = "";
        document.getElementById("draw_storke").style.height = "0";
        document.getElementById("draw_stroke_width").style.height = "0";
        document.getElementById("draw_fill_storke_mark").style.top = "0";
        document.getElementById("draw_fill_storke_mark").title = "当前为填充";
    } else {
        document.getElementById("draw_fill").style.height = "0";
        document.getElementById("draw_storke").style.height = "";
        document.getElementById("draw_stroke_width").style.height = "";
        document.getElementById("draw_fill_storke_mark").style.top = "calc(var(--bar-size) / 2)";
        document.getElementById("draw_fill_storke_mark").title = "当前为描边";
    }
}

// 输入颜色
var colorAlphaInput1 = <HTMLInputElement>document.querySelector("#draw_fill > range-b");
colorFillEl.oninput = () => {
    changeColor({ fill: colorFillEl.innerText }, true, false);
    var fillA = Color(colorFillEl.innerText).alpha();
    colorAlphaInput1.value = String(Math.round(fillA * 100));
};
var colorAlphaInput2 = <HTMLInputElement>document.querySelector("#draw_storke > range-b");
colorStrokeEl.oninput = () => {
    changeColor({ stroke: colorStrokeEl.innerText }, true, false);
    var strokeA = Color(colorStrokeEl.innerText).alpha();
    colorAlphaInput2.value = String(Math.round(strokeA * 100));
};

// 改变透明度
colorAlphaInput1.oninput = () => {
    changeAlpha(colorAlphaInput1.value, "fill");
};
colorAlphaInput2.oninput = () => {
    changeAlpha(colorAlphaInput2.value, "stroke");
};
function changeAlpha(v, m) {
    var rgba = Color(document.getElementById(`draw_color_${m}`).style.backgroundColor)
        .rgb()
        .array();
    rgba[3] = v / 100;
    changeColor({ [m]: rgba }, true, true);
}

const drawItemsEl = document.getElementById("draw_color_size_i");
function ableChangeColor() {
    if (fabricCanvas.isDrawingMode || shape || fabricCanvas.getActiveObject()) {
        drawItemsEl.style.pointerEvents = "auto";
        drawItemsEl.style.opacity = "1";
    } else {
        drawItemsEl.style.pointerEvents = "none";
        drawItemsEl.style.opacity = "0.2";
    }
}
ableChangeColor();

// 刷新控件颜色
/**
 * 改变颜色
 * @param {{fill?: String, stroke?: String}} mL
 * @param {Boolean} setO 是否改变选中形状样式
 * @param {Boolean} text 是否更改文字，仅在input时为true
 */
function changeColor(mL: { fill?: string; stroke?: string }, setO: boolean, text: boolean) {
    for (let i in mL) {
        var colorM = i,
            color = mL[i];
        if (color === null) color = "#0000";
        var colorL = Color(color).rgb().array();
        document.getElementById(`draw_color_${colorM}`).style.backgroundColor = Color(colorL).string();
        if (colorM == "fill") {
            (<HTMLDivElement>document.querySelector("#draw_color > div")).style.backgroundColor =
                Color(colorL).string();
            if (setO) setFObjectV(Color(colorL).string(), null, null);
        }
        if (colorM == "stroke") {
            (<HTMLDivElement>document.querySelector("#draw_color > div")).style.borderColor = Color(colorL).string();
            if (setO) setFObjectV(null, Color(colorL).string(), null);
        }

        // 文字自适应
        var tColor = Color(document.getElementById(`draw_color_${colorM}`).style.backgroundColor);
        var bgColor = Color(getComputedStyle(document.documentElement).getPropertyValue("--bar-bg").replace(" ", ""));
        if (tColor.rgb().array()[3] >= 0.5 || tColor.rgb().array()[3] === undefined) {
            if (tColor.isLight()) {
                document.getElementById(`draw_color_${colorM}`).style.color = "#000";
            } else {
                document.getElementById(`draw_color_${colorM}`).style.color = "#fff";
            }
        } else {
            // 低透明度背景呈现栏的颜色
            if (bgColor.isLight()) {
                document.getElementById(`draw_color_${colorM}`).style.color = "#000";
            } else {
                document.getElementById(`draw_color_${colorM}`).style.color = "#fff";
            }
        }

        if (text) {
            document.getElementById(`draw_color_${colorM}`).innerText = Color(color).hexa();
        }
    }
}

// 色盘
function colorBar() {
    // 主盘
    var colorList = ["hsl(0, 0%, 100%)"];
    var baseColor = Color("hsl(0, 100%, 50%)");
    for (let i = 0; i < 360; i += 15) {
        colorList.push(baseColor.rotate(i).string());
    }
    showColor();
    // 下一层级
    function nextColor(h) {
        var nextColorList = [];
        if (h == "hsl(0, 0%, 100%)") {
            for (let i = 255; i >= 0; i = Number((i - 10.625).toFixed(3))) {
                nextColorList.push(`rgb(${i}, ${i}, ${i})`);
            }
        } else {
            h = h.match(/hsl\(([0-9]*)/)[1] - 0;
            for (let i = 90; i > 0; i -= 20) {
                for (let j = 100; j > 0; j -= 20) {
                    nextColorList.push(`hsl(${h}, ${j}%, ${i}%)`);
                }
            }
        }
        var tt = "";
        for (let n in nextColorList) {
            tt += `<div class="color_i" style="background-color: ${nextColorList[n]}" title="${colorConversion(
                nextColorList[n],
                取色器默认格式
            )}"></div>`;
        }
        document.querySelector("#draw_color_color").innerHTML = tt;
        document.querySelectorAll("#draw_color_color > div").forEach((el: HTMLElement, _index) => {
            el.onmousedown = (event) => {
                if (event.button == 0) {
                    cColor(el);
                } else {
                    // 回到主盘
                    showColor();
                }
            };
        });
        nextColorList = tt = null;
    }
    function showColor() {
        var t = "";
        for (let x of colorList) {
            t += `<div class="color_i" style="background-color: ${x}" title="${colorConversion(
                x,
                取色器默认格式
            )}"></div>`;
        }
        document.querySelector("#draw_color_color").innerHTML = t;
        document.querySelectorAll("#draw_color_color > div").forEach((el: HTMLElement, index) => {
            el.onmousedown = (event) => {
                if (event.button == 0) {
                    cColor(el);
                } else {
                    // 下一层级
                    nextColor(colorList[index]);
                }
            };
        });
        t = null;
    }
    // 事件
    function cColor(el) {
        changeColor({ [colorM]: el.style.backgroundColor }, true, true);
        if (colorM == "fill") colorAlphaInput1.value = "100";
        if (colorM == "stroke") colorAlphaInput2.value = "100";
    }
}
colorBar();

(<HTMLInputElement>document.querySelector("#draw_stroke_width > range-b")).oninput = () => {
    setFObjectV(null, null, Number((<HTMLInputElement>document.querySelector("#draw_stroke_width > range-b")).value));
};

/** 鼠标点击后，改变栏文字样式 */
function getFObjectV() {
    if (fabricCanvas.getActiveObject()) {
        var n = fabricCanvas.getActiveObject();
        if (n._objects) {
            // 当线与形一起选中，确保形不会透明
            for (let i of n._objects) {
                if (i.canChangeFill) n = i;
            }
        }
        if (n.filters) n = { fill: fillColor, stroke: strokeColor, strokeWidth: strokeWidth };
    } else if (fabricCanvas.isDrawingMode) {
        n = { fill: "#0000", stroke: freeColor, strokeWidth: freeWidth };
    } else {
        n = { fill: fillColor, stroke: strokeColor, strokeWidth: strokeWidth };
    }
    console.log(n);
    var [fill, stroke, strokeWidth] = [n.fill, n.stroke, n.strokeWidth];
    (<HTMLInputElement>document.querySelector("#draw_stroke_width > range-b")).value = strokeWidth;
    changeColor({ fill: fill, stroke: stroke }, false, true);
    var fill_a = Color(colorFillEl.innerText).alpha();
    colorAlphaInput1.value = String(Math.round(fill_a * 100));
    var stroke_a = Color(colorStrokeEl.innerText).alpha();
    colorAlphaInput2.value = String(Math.round(stroke_a * 100));

    ableChangeColor();
}
/**
 * 更改全局或选中形状的颜色
 * @param {String} fill 填充颜色
 * @param {String} stroke 边框颜色
 * @param {Number} sw 边框宽度
 */
function setFObjectV(fill: string, stroke: string, sw: number) {
    if (fabricCanvas.getActiveObject()) {
        console.log(0);
        /* 选中Object */
        var n = fabricCanvas.getActiveObject(); /* 选中多个时，n下有_Object<形状>数组，1个时，n就是形状 */
        n = n._objects || [n];
        for (let i in n) {
            if (fill) {
                // 只改变形的颜色
                if (n[i].canChangeFill) n[i].set("fill", fill);
            }
            if (stroke) n[i].set("stroke", stroke);
            if (sw) n[i].set("strokeWidth", sw);
            if (n[i].形状) {
                store.set(`图像编辑.形状属性.${n[i].形状}.fc`, fill || fillColor);
                store.set(`图像编辑.形状属性.${n[i].形状}.sc`, stroke || strokeColor);
                store.set(`图像编辑.形状属性.${n[i].形状}.sw`, sw || strokeWidth);
            }
        }
        fabricCanvas.renderAll();
    } else if (fabricCanvas.isDrawingMode) {
        console.log(1);
        /* 画笔 */
        if (stroke) fabricCanvas.freeDrawingBrush.color = freeColor = stroke;
        if (sw) fabricCanvas.freeDrawingBrush.width = freeWidth = sw;
        freeDrawCursor();
        freeShadow();
        if (mode) {
            store.set(`图像编辑.形状属性.${mode}.sc`, stroke || strokeColor);
            store.set(`图像编辑.形状属性.${mode}.sw`, sw || strokeWidth);
        }
    } else {
        console.log(2);
        /* 非画笔非选中 */
        if (fill) fillColor = fill;
        if (stroke) strokeColor = freeColor = stroke;
        if (sw) strokeWidth = sw;
    }
}

// 滤镜
fabricCanvas.filterBackend = Fabric.initFilterBackend();
var webglBackend;
try {
    webglBackend = new Fabric.WebglFilterBackend();
    fabricCanvas.filterBackend = webglBackend;
} catch (e) {
    console.log(e);
}

var newFilterSelecting = false;
function newFilterSelect(o, no) {
    var x1 = o.x.toFixed(),
        y1 = o.y.toFixed(),
        x2 = no.x.toFixed(),
        y2 = no.y.toFixed();
    var x = Math.min(x1, x2),
        y = Math.min(y1, y2),
        w = Math.abs(x1 - x2),
        h = Math.abs(y1 - y2);

    var mainCtx = mainCanvas.getContext("2d");
    var tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    var gid = mainCtx.getImageData(x, y, w, h); // 裁剪
    tmpCanvas.getContext("2d").putImageData(gid, 0, 0);
    var img = new Fabric.Image(tmpCanvas, {
        left: x,
        top: y,
        lockMovementX: true,
        lockMovementY: true,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true,
        hasControls: false,
        hoverCursor: "auto",
    });
    fabricCanvas.add(img);
    fabricCanvas.setActiveObject(img);
}

(<HTMLInputElement>(<HTMLInputElement>document.querySelector("#draw_filters_select > lock-b"))).oninput = () => {
    exitFree();
    exitShape();
    newFilterSelecting = true;
    fabricCanvas.defaultCursor = "crosshair";
    hotkeys.setScope("drawing_esc");
    setEditType("filter", "");
};

function applyFilter(i, filter) {
    var obj = fabricCanvas.getActiveObject();
    obj.filters[i] = filter;
    obj.applyFilters();
    fabricCanvas.renderAll();
}
function getFilters() {
    if (fabricCanvas.getActiveObject()?.filters !== undefined) {
        SHFiltersDiv(false);
    } else {
        SHFiltersDiv(true);
        return;
    }
    var f = fabricCanvas.getActiveObject().filters;
    console.log(f);
    (<HTMLInputElement>document.querySelector("#draw_filters_pixelate > range-b")).value = String(f[0]?.blocksize || 0);
    (<HTMLInputElement>document.querySelector("#draw_filters_blur > range-b")).value = String(f[1]?.blur * 100 || 0);
    (<HTMLInputElement>document.querySelector("#draw_filters_brightness > range-b")).value = String(
        f[2]?.brightness || 0
    );
    (<HTMLInputElement>document.querySelector("#draw_filters_contrast > range-b")).value = String(f[3]?.contrast || 0);
    (<HTMLInputElement>document.querySelector("#draw_filters_saturation > range-b")).value = String(
        f[4]?.saturation || 0
    );
    (<HTMLInputElement>document.querySelector("#draw_filters_hue > range-b")).value = String(f[5]?.rotation || 0);
    (<HTMLInputElement>document.querySelector("#draw_filters_gamma > range-b:nth-child(1)")).value = String(
        f[6]?.gamma[0] || 1
    );
    (<HTMLInputElement>document.querySelector("#draw_filters_gamma > range-b:nth-child(2)")).value = String(
        f[6]?.gamma[1] || 1
    );
    (<HTMLInputElement>document.querySelector("#draw_filters_gamma > range-b:nth-child(3)")).value = String(
        f[6]?.gamma[2] || 1
    );
    (<HTMLInputElement>document.querySelector("#draw_filters_noise > range-b")).value = String(f[7]?.noise || 0);
    var gray = f[8]?.mode;
    switch (gray) {
        case "average":
            (<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(1)")).checked = true;
            break;
        case "lightness":
            (<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(2)")).checked = true;
            break;
        case "luminosity":
            (<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(3)")).checked = true;
        default:
            (<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(1)")).checked = false;
            (<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(2)")).checked = false;
            (<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(3)")).checked = false;
    }
    (<HTMLInputElement>document.querySelector("#draw_filters_invert > lock-b")).checked = f[9] ? true : false;
    (<HTMLInputElement>document.querySelector("#draw_filters_sepia > lock-b")).checked = f[10] ? true : false;
    (<HTMLInputElement>document.querySelector("#draw_filters_bw > lock-b")).checked = f[11] ? true : false;
    (<HTMLInputElement>document.querySelector("#draw_filters_brownie > lock-b")).checked = f[12] ? true : false;
    (<HTMLInputElement>document.querySelector("#draw_filters_vintage > lock-b")).checked = f[13] ? true : false;
    (<HTMLInputElement>document.querySelector("#draw_filters_koda > lock-b")).checked = f[14] ? true : false;
    (<HTMLInputElement>document.querySelector("#draw_filters_techni > lock-b")).checked = f[15] ? true : false;
    (<HTMLInputElement>document.querySelector("#draw_filters_polaroid > lock-b")).checked = f[16] ? true : false;
}
function SHFiltersDiv(v) {
    var l = document.querySelectorAll("#draw_filters_i > div") as NodeListOf<HTMLDivElement>;
    if (v) {
        for (let i = 1; i < l.length; i++) {
            l[i].style.pointerEvents = "none";
            l[i].style.opacity = "0.2";
        }
    } else {
        for (let i = 1; i < l.length; i++) {
            l[i].style.pointerEvents = "auto";
            l[i].style.opacity = "1";
        }
    }
}
SHFiltersDiv(true);

/**
 * 设置滤镜 滑块
 * @param id 元素名
 * @param f 函数名
 * @param key 参数key
 * @param i 滤镜索引
 * @param is_z 检查值是否为0
 */
function checkFilterRangeInput(id: string, f: string, key: string, i: number, is_z?: boolean) {
    (<HTMLInputElement>document.querySelector(`#draw_filters_${id} > range-b`)).oninput = () => {
        const value = Number((<HTMLInputElement>document.querySelector(`#draw_filters_${id} > range-b`)).value);
        if (!is_z || value != 0) {
            let filter = new Fabric.Image.filters[f]({
                [key]: value,
            });
            applyFilter(i, filter);
        } else {
            applyFilter(i, null);
        }
    };
}

/**
 * 设置滤镜 选定
 * @param id 元素名
 * @param f 函数名
 * @param i 滤镜索引
 */
function checkFilterLockInput(id: string, f: string, i: number) {
    (<HTMLInputElement>document.querySelector(`#draw_filters_${id} > lock-b`)).oninput = () => {
        const value = (<HTMLInputElement>document.querySelector(`#draw_filters_${id} > lock-b`)).checked;
        let filter = value ? new Fabric.Image.filters[f]() : null;
        applyFilter(i, filter);
    };
}
// 马赛克
// 在fabric源码第二个uBlocksize * uStepW改为uBlocksize * uStepH
checkFilterRangeInput("pixelate", "Pixelate", "blocksize", 0, true);
// 模糊
checkFilterRangeInput("blur", "Blur", "blur", 1, true);
// 亮度
checkFilterRangeInput("brightness", "Brightness", "brightness", 2);
// 对比度
checkFilterRangeInput("contrast", "Contrast", "contrast", 3);
// 饱和度
checkFilterRangeInput("saturation", "Saturation", "saturation", 4);
// 色调
checkFilterRangeInput("hue", "HueRotation", "rotation", 5);
// 伽马
(<HTMLInputElement>document.querySelector("#draw_filters_gamma > range-b:nth-child(1)")).oninput =
    (<HTMLInputElement>document.querySelector("#draw_filters_gamma > range-b:nth-child(2)")).oninput =
    (<HTMLInputElement>document.querySelector("#draw_filters_gamma > range-b:nth-child(3)")).oninput =
        () => {
            var r = (<HTMLInputElement>document.querySelector("#draw_filters_gamma > range-b:nth-child(1)")).value;
            var g = (<HTMLInputElement>document.querySelector("#draw_filters_gamma > range-b:nth-child(2)")).value;
            var b = (<HTMLInputElement>document.querySelector("#draw_filters_gamma > range-b:nth-child(3)")).value;
            var filter = new Fabric.Image.filters.Gamma({
                gamma: [r, g, b],
            });
            applyFilter(6, filter);
        };
// 噪音
checkFilterRangeInput("noise", "Noise", "noise", 7);
// 灰度
(<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(1)")).oninput = () => {
    (<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(2)")).checked = false;
    (<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(3)")).checked = false;
    if ((<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(1)")).checked)
        var filter = new Fabric.Image.filters.Grayscale({ mode: "average" });
    applyFilter(8, filter);
};
(<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(2)")).oninput = () => {
    (<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(1)")).checked = false;
    (<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(3)")).checked = false;
    if ((<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(2)")).checked)
        var filter = new Fabric.Image.filters.Grayscale({ mode: "lightness" });
    applyFilter(8, filter);
};
(<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(3)")).oninput = () => {
    (<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(1)")).checked = false;
    (<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(2)")).checked = false;
    if ((<HTMLInputElement>document.querySelector("#draw_filters_grayscale > lock-b:nth-child(3)")).checked)
        var filter = new Fabric.Image.filters.Grayscale({ mode: "luminosity" });
    applyFilter(8, filter);
};
// 负片
checkFilterLockInput("invert", "Invert", 9);
// 棕褐色
checkFilterLockInput("sepia", "Sepia", 10);
// 黑白
checkFilterLockInput("bw", "BlackWhite", 11);
// 布朗尼
checkFilterLockInput("brownie", "Brownie", 12);
// 老式
checkFilterLockInput("vintage", "Vintage", 13);
// 柯达彩色胶片
checkFilterLockInput("koda", "Kodachrome", 14);
// 特艺色彩
checkFilterLockInput("techni", "Technicolor", 15);
// 宝丽来
checkFilterLockInput("polaroid", "Polaroid", 16);

// 确保退出其他需要鼠标事件的东西，以免多个东西一起出现
function exitFree() {
    fabricCanvas.isDrawingMode = false;
    fabricCanvas.defaultCursor = "auto";
}
function exitShape() {
    shape = "";
    drawingShape = false;
    fabricCanvas.selection = true;
    fabricCanvas.defaultCursor = "auto";
    polyOP = [];
}
function exitFilter() {
    newFilterSelecting = false;
    (<HTMLInputElement>document.querySelector("#draw_filters_select > lock-b")).checked = false;
    fabricCanvas.defaultCursor = "auto";
}
hotkeys("esc", "drawing_esc", () => {
    exitFree();
    exitShape();
    exitFilter();
    hotkeys.setScope("normal");
});

// fabric命令行
var drawEditInputEl = <HTMLInputElement>document.querySelector("#draw_edit input");
hotkeys("f12", "normal", () => {
    sCenterBar("edit");
    if (centerBarShow) {
        drawEditInputEl.focus();
        hotkeys("enter", "c_bar", fabricApi);
        hotkeys("esc", "c_bar", () => {
            sCenterBar("edit");
        });
    }
});
document.getElementById("draw_edit_run").onclick = () => {
    fabricApi();
};
function fabricApi() {
    var e = drawEditInputEl.value;
    window["$0"] = fabricCanvas.getActiveObject();
    if (!e.includes("$0")) {
        e = `fabric_canvas.getActiveObject().set({${e}})`;
    }
    var div = document.createElement("div");
    div.innerText = eval(e);
    document.getElementById("draw_edit_output").appendChild(div);
    document.getElementById("draw_edit_output").style.margin = "4px";
    fabricCanvas.renderAll();
}
document.getElementById("draw_edit_clear").onclick = () => {
    document.getElementById("draw_edit_output").innerHTML = "";
    document.getElementById("draw_edit_output").style.margin = "";
};

var fabricClipboard;
function fabricCopy() {
    var dx = store.get("图像编辑.复制偏移.x"),
        dy = store.get("图像编辑.复制偏移.y");
    fabricCanvas.getActiveObject().clone(function (cloned) {
        fabricClipboard = cloned;
    });
    fabricClipboard.clone(function (clonedObj) {
        fabricCanvas.discardActiveObject();
        clonedObj.set({
            left: clonedObj.left + dx,
            top: clonedObj.top + dy,
            evented: true,
        });
        if (clonedObj.type === "activeSelection") {
            clonedObj.fabric_canvas = fabricCanvas;
            clonedObj.forEachObject(function (obj) {
                fabricCanvas.add(obj);
            });
            clonedObj.setCoords();
        } else {
            fabricCanvas.add(clonedObj);
        }
        fabricCanvas.setActiveObject(clonedObj);
        fabricCanvas.requestRenderAll();
    });
    hisPush();
}
hotkeys("Ctrl+v", "normal", fabricCopy);

// 插件
for (let p of store.get("插件.加载后")) {
    if (p.match(/\.css$/i)) {
        let i = document.createElement("link");
        i.rel = "stylesheet";
        i.type = "text/css";
        i.href = p;
        document.body.before(i);
    } else {
        let s = document.createElement("script");
        s.src = p;
        document.body.before(s);
    }
}

// 检查应用更新

import pack from "../../../package.json?raw";
import { setting, EditType, 功能, translateWinType } from "../../ShareTypes.js";
var packageJson = JSON.parse(pack);

function checkUpdate() {
    fetch("https://api.github.com/repos/xushengfeng/eSearch/releases")
        .then((v) => v.json())
        .then((re) => {
            let l = [];
            for (let r of re) {
                if (
                    !packageJson.version.includes("beta") &&
                    !packageJson.version.includes("alpha") &&
                    !store.get("更新.dev")
                ) {
                    if (!r.draft && !r.prerelease) l.push(r);
                } else {
                    l.push(r);
                }
            }
            for (let i in l) {
                const r = l[i];
                if (r.name == packageJson.version) {
                    if (i != "0") {
                        ipcRenderer.send("clip_main_b", "new_version", { v: l[0].name, url: l[0].html_url });
                    }
                    break;
                }
            }
        });
}

if (store.get("更新.频率") == "start") checkUpdate();
if (store.get("更新.频率") == "weekly") {
    let time = new Date();
    if (time.getDay() == 6 && time.getTime() - store.get("更新.上次更新时间") > 24 * 60 * 60 * 1000) {
        store.set("更新.上次更新时间", time.getTime());
        checkUpdate();
    }
}
