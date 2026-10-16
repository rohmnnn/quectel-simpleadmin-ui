# Quectel SimpleAdmin UI

[English](README.md) | 简体中文

**SimpleAdmin** 的响应式重设计界面。SimpleAdmin 是
[iamromulan/quectel-rgmii-toolkit](https://github.com/iamromulan/quectel-rgmii-toolkit/tree/SDXLEMUR)
（SDXLEMUR 分支）自带的网页管理面板。本项目是对 SimpleAdmin 中文版（Rev-Alpha-0.9）前端的全面重写，界面语言为简体中文。

> **状态：开发中。** 目前只重写了应用框架和首页。网络、扫网、短信、设置、设备信息这几页仍是设备上原有的 SimpleAdmin 页面。

## 署名（Attribution）

SimpleAdmin 和 quectel-rgmii-toolkit 的作者是 **iamromulan**：
<https://github.com/iamromulan/quectel-rgmii-toolkit>。

本项目经由中文版衍生自上述项目，采用相同的许可证。[`www/js/signal.js`](www/js/signal.js) 中的 AT 返回解析与信号评分代码原样取自 SimpleAdmin 原首页。

本项目与 iamromulan、移远通信（Quectel）均无隶属或背书关系。

## 功能

**应用框架**

- 桌面（≥ 1024 px）显示侧边栏，平板（768–1023 px）显示图标栏，手机显示底部标签栏（Tab Bar）。
- 浅色 / 深色主题：用户未手动选择时跟随系统，选择结果保存在 `localStorage`。
- 状态条显示距上次读取数据过了多久。

**首页**

- 综合信号仪表：按 RSRP 和 SINR 综合评分，算法与原页面一致，读数和旧界面对得上。
- RSRP、RSRQ、SINR 三项分档刻度条。
- 单天线读数（PRX / DRX / RX2 / RX3），可切换 4G / 5G。
- 最近 5 分钟的 RSRP、SINR 趋势图（最多 150 个点），读不到数据的时段曲线断开，不按 0 绘制。
- 概览卡片：连接、网络、模块温度、SIM。
- 可折叠的详细参数表：PCI、小区 ID、TAC、EARFCN、频段、带宽、CSQ、APN、IPv4 / IPv6、MCCMNC。
- 刷新间隔可调（最低 2 秒），支持暂停；浏览器标签页隐藏时自动暂停。

**Watchcat 页**：仅占位，不调用任何接口。Watchcat（断网自动恢复）在已测试的固件上不可用。

## 设计原则

- **只改展示层**：只用设备上已有的 CGI 接口，不新增接口，不改 AT 命令和设备配置。
- **首页只读**：首页只发送查询类 AT 命令。
- **无构建、无依赖**：纯 HTML、CSS、JavaScript。

## 用到的接口

| 接口 | 用途 |
|---|---|
| `GET /cgi-bin/get_atcommand?atcmd=…` | 每次刷新合并发送一条 AT 查询：`+QSIMSTAT?` `+CSQ` `+QTEMP` `+QUIMSLOT?` `+QSPN` `+CGCONTRDP=1` `+QMAP="WWANIP"` `+QENG="servingcell"` `+QNWINFO` `+QRSRP` `+QRSRQ` `+QSINR` |
| `GET /cgi-bin/get_ping` | 延迟（仅在 SIM 已激活时请求） |
| `GET /cgi-bin/get_uptime` | 运行时长 |

## 兼容性

| 项目 | 已测试环境 |
|---|---|
| 模组 | Quectel RG520N-CN |
| 固件 | RG520NCNAAR03A01M4G |
| 面板 | SimpleAdmin Rev-Alpha-0.9（中文版），lighttpd 1.4.73 |
| 浏览器 | macOS 上的 Chrome |

其他 SDXLEMUR 系列模组（如 RM520N-GL）和其他浏览器尚未测试。

## 目录结构

```text
www/
├── index.html       首页
├── more.html        「更多」菜单（手机标签栏）
├── watchcat.html    Watchcat 占位页
├── css/app.css      设计变量（Design Tokens）、布局、组件
└── js/
    ├── shell.js     导航、主题、状态条
    ├── signal.js    AT 解析与信号评分（原样取自原页面）
    └── home.js      首页轮询与渲染
```

## 部署到设备

需要设备的 root shell（adb、SSH 或 ttyd 网页终端），且 SimpleAdmin 安装在 `/usrdata/simpleadmin`。只新增或覆盖上面 7 个文件；设备上的其他内容（其他页面、`cgi-bin/`、`.htpasswd`、证书、`lighttpd.conf`）一律不动。

1. 在电脑上打包。`COPYFILE_DISABLE=1` 防止 macOS 往包里塞 `._*` 文件。

   ```sh
   COPYFILE_DISABLE=1 tar -C www -cf ui.tar .
   ```

2. 用你手头可用的方式把 `ui.tar` 传到设备的 `/usrdata/simpleadmin/`。不要放 `/tmp`，那里可能会被清空。

3. 在设备上备份并解包：

   ```sh
   cd /usrdata/simpleadmin
   cp -a www "www.bak-$(date +%Y%m%d-%H%M)"
   tar -xf ui.tar -C www
   cd www
   FILES="index.html more.html watchcat.html css/app.css js/shell.js js/signal.js js/home.js"
   chown root:root $FILES
   chmod 644 $FILES
   rm ../ui.tar
   ```

4. 浏览器强制刷新。改了 CSS 或 JS 后，要同步修改三个 HTML 文件里的 `?v=` 版本号，浏览器才会拉取新文件。

**回滚**

```sh
cd /usrdata/simpleadmin
mv www www.broken
cp -a www.bak-YYYYMMDD-HHMM www
```

## 消除「不安全」提示（可选）

设备自带自签名证书（Self-signed Certificate），浏览器会标记为不安全。一种处理方法：

1. 在电脑上用 [mkcert](https://github.com/FiloSottile/mkcert) 建本地 CA，签发证书，SAN 必须包含 `IP:192.168.225.1`（或你的设备 IP）。
2. 备份 `/usrdata/simpleadmin/server.crt` 和 `server.key`，换成新证书和私钥，文件权限与原文件保持一致，然后执行 `systemctl reload lighttpd`。
3. 在每台访问设备上导入 CA 根证书。

CA 私钥（`rootCA-key.pem`）只能留在你的电脑上，不要拷进设备，也不要提交进仓库；`.gitignore` 已排除 `*.pem`、`*.key`、`*.crt`。

## 路线图

- [x] 应用框架
- [x] 首页
- [ ] 网络
- [ ] 扫网
- [ ] 短信
- [ ] 设置
- [ ] 设备信息
- [ ] Watchcat（受阻：已测试的固件上不可用）

## 免责声明

使用风险自负。首页只读，但开发中的页面可能发送会修改模组设置的 AT 命令。Quectel 是上海移远通信技术股份有限公司（Quectel Wireless Solutions Co., Ltd.）的商标。

## 许可证

与上游相同：**MIT License with Additional Stipulations**（附加条款的 MIT 许可证），全文见 [LICENSE](LICENSE)。在标准 MIT 条款之外：

1. 必须在显眼位置注明原作者（iamromulan）并附原仓库链接。
2. 本软件及其任何修改版不得出售或收费；销售内置本软件的实体产品是允许的，但同样需要署名。
3. 任何人提出要求时，必须提供修改后的源码以及理解这些修改所需的文档。

由于含「禁止售卖」条款，本许可证不属于 OSI 认证的开源许可证。
