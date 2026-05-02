// ==UserScript==
// @name         QQ空间动态批量获取
// @namespace    https://github.com/qqzone-fetch
// @version      1.1.0
// @description  批量获取QQ空间好友动态/说说，支持翻页、去重、导出JSON/CSV、原图下载
// @author       qqzone-fetch
// @match        https://user.qzone.qq.com/*
// @match        https://qzs.qq.com/*
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      a1.qpic.cn
// @connect      r.photo.store.qq.com
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    function calcGtk(skey) {
        let h = 5381;
        for (let i = 0; i < skey.length; i++) {
            h += (h << 5) + skey.charCodeAt(i);
        }
        return h & 0x7fffffff;
    }

    function getCookie(name) {
        const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : '';
    }

    function extractFeedData(html) {
        const result = { content: '', images: [], videoUrl: '' };
        if (!html) return result;

        const decoded = html.replace(/\\x3C/g, '<').replace(/\\x3E/g, '>').replace(/\\x22/g, '"').replace(/\\x27/g, "'").replace(/\\\//g, '/');

        const infoM = decoded.match(/<div\s+class="f-info"[^>]*>([\s\S]*?)<\/div>/);
        if (infoM) {
            let t = infoM[1];
            t = t.replace(/<img[^>]*title="([^"]*)"[^>]*\/?>/g, '$1');
            t = t.replace(/<br\s*\/?\s*>/g, '\n');
            t = t.replace(/<[^>]+>/g, '');
            t = t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
            result.content = t.trim();
        }

        const imgSrcs = decoded.match(/<img[^>]+src="([^"]+)"/g) || [];
        for (const tag of imgSrcs) {
            const srcM = tag.match(/src="([^"]+)"/);
            if (!srcM) continue;
            let src = srcM[1].replace(/&amp;/g, '&');
            if (!src.includes('qpic.cn') || src.includes('qlogo')) continue;
            src = src.replace(/!\/(?:m|c|s)(?=&|$)/, '!/b');
            if (!result.images.includes(src)) result.images.push(src);
        }

        const videoM = decoded.match(/src="(https?:\/\/photovideo\.photo\.qq\.com[^"]+)"/);
        if (videoM) {
            result.videoUrl = videoM[1].replace(/&amp;/g, '&');
        }

        return result;
    }

    function downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }

    function toCSV(feeds) {
        let csv = '\uFEFF序号,昵称,QQ号,文案内容,图片链接,视频链接,时间\n';
        feeds.forEach((f, i) => {
            const c = (f.content || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
            const n = (f.nickname || '').replace(/"/g, '""');
            const imgs = (f.images || []).join(' | ');
            const vid = f.videoUrl || '';
            csv += `${i + 1},"${n}","${f.uin}","${c}","${imgs}","${vid}","${f.time}"\n`;
        });
        return csv;
    }

    GM_addStyle(`
        #qz-fab {
            position: fixed; top: 20px; right: 20px; z-index: 999999;
            width: 48px; height: 48px; border-radius: 50%;
            background: #000; color: #fff; border: none; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            transition: opacity 0.15s;
            user-select: none;
        }
        #qz-fab:hover { opacity: 0.8; }

        #qz-panel {
            position: fixed; top: 78px; right: 20px; z-index: 999998;
            width: 460px; max-height: 82vh;
            background: #fff;
            border: 1px solid #e5e5e5;
            border-radius: 12px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.08);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            font-size: 13px; color: #1a1a1a;
            display: none; flex-direction: column;
            overflow: hidden;
        }
        #qz-panel.open { display: flex; }

        #qz-panel-header {
            padding: 14px 20px;
            border-bottom: 1px solid #f0f0f0;
            display: flex; align-items: center; justify-content: space-between;
            cursor: move; user-select: none; flex-shrink: 0;
        }
        #qz-panel-header .qz-title {
            font-size: 15px; font-weight: 600; color: #000;
        }
        #qz-close {
            width: 28px; height: 28px; border-radius: 6px;
            background: transparent; border: none;
            color: #999; font-size: 16px;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: all 0.15s;
        }
        #qz-close:hover { background: #f5f5f5; color: #333; }

        #qz-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
        #qz-body::-webkit-scrollbar { width: 5px; }
        #qz-body::-webkit-scrollbar-thumb { background: #ddd; border-radius: 3px; }
        #qz-body::-webkit-scrollbar-track { background: transparent; }

        .qz-section {
            margin-bottom: 14px;
            padding: 0;
        }
        .qz-section-title {
            font-size: 11px; font-weight: 600;
            letter-spacing: 0.02em; color: #999;
            margin-bottom: 8px;
        }

        .qz-row { display: flex; align-items: center; gap: 10px; }
        .qz-label { font-size: 13px; color: #666; white-space: nowrap; }
        .qz-input {
            flex: 1; padding: 8px 12px;
            background: #fff;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            font-size: 13px; color: #1a1a1a;
            outline: none; transition: border-color 0.15s;
            font-family: inherit;
        }
        .qz-input:focus { border-color: #000; }
        .qz-input::placeholder { color: #bbb; }

        .qz-config-grid {
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
        }
        .qz-config-item { display: flex; flex-direction: column; gap: 4px; }
        .qz-config-item label { font-size: 11px; color: #999; }
        .qz-config-item input {
            width: 100%; padding: 7px 8px; box-sizing: border-box;
            background: #fff; border: 1px solid #e0e0e0;
            border-radius: 8px; font-size: 12px; color: #1a1a1a;
            outline: none; transition: border-color 0.15s;
            font-family: -apple-system, BlinkMacSystemFont, monospace;
        }
        .qz-config-item input:focus { border-color: #000; }

        .qz-filters { display: flex; gap: 20px; }
        .qz-switch-wrap { display: flex; align-items: center; gap: 8px; }
        .qz-switch-wrap span { font-size: 12px; color: #666; }
        .qz-switch { position: relative; display: inline-block; width: 36px; height: 20px; }
        .qz-switch input { opacity: 0; width: 0; height: 0; }
        .qz-switch-slider {
            position: absolute; cursor: pointer; inset: 0;
            background: #ddd; border-radius: 10px; transition: 0.2s;
        }
        .qz-switch-slider::before {
            content: ''; position: absolute; height: 16px; width: 16px;
            left: 2px; bottom: 2px; background: #fff;
            border-radius: 50%; transition: 0.2s;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        .qz-switch input:checked + .qz-switch-slider { background: #000; }
        .qz-switch input:checked + .qz-switch-slider::before { transform: translateX(16px); }

        .qz-action-row { display: flex; gap: 8px; }
        .qz-btn {
            flex: 1; padding: 9px 16px; border: none; border-radius: 8px;
            font-size: 13px; font-weight: 500; cursor: pointer;
            transition: opacity 0.15s;
            font-family: inherit;
        }
        .qz-btn:active { opacity: 0.7; }
        .qz-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .qz-btn-primary { background: #000; color: #fff; }
        .qz-btn-primary:hover:not(:disabled) { opacity: 0.85; }
        .qz-btn-danger { background: #fff; color: #e00; border: 1px solid #e0e0e0; }
        .qz-btn-danger:hover:not(:disabled) { background: #fff5f5; }
        .qz-btn-ghost { background: #fff; color: #333; border: 1px solid #e0e0e0; }
        .qz-btn-ghost:hover { background: #f9f9f9; }
        .qz-btn-sm { padding: 6px 14px; font-size: 12px; }

        #qz-progress-wrap {
            width: 100%; height: 3px; background: #f0f0f0;
            border-radius: 2px; overflow: hidden; margin-bottom: 12px;
        }
        #qz-progress-bar {
            height: 100%; width: 0%;
            background: #000;
            border-radius: 2px; transition: width 0.3s;
        }

        #qz-log {
            max-height: 120px; overflow-y: auto; font-size: 11px;
            background: #fafafa; border: 1px solid #f0f0f0;
            border-radius: 8px; padding: 10px 12px;
            margin-bottom: 12px; line-height: 1.8;
            color: #999;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
        }
        #qz-log::-webkit-scrollbar { width: 3px; }
        #qz-log::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 2px; }

        #qz-stats { display: flex; gap: 10px; margin-bottom: 12px; }
        .qz-stat {
            flex: 1; padding: 10px 8px;
            background: #fafafa;
            border: 1px solid #f0f0f0;
            border-radius: 8px; text-align: center;
        }
        .qz-stat-val {
            font-size: 22px; font-weight: 700; letter-spacing: -0.02em;
            color: #000;
        }
        .qz-stat-label { font-size: 10px; color: #999; margin-top: 2px; }

        #qz-table-wrap {
            max-height: 280px; overflow: auto; border-radius: 8px;
            border: 1px solid #f0f0f0;
            margin-bottom: 12px;
        }
        #qz-table-wrap::-webkit-scrollbar { width: 5px; }
        #qz-table-wrap::-webkit-scrollbar-thumb { background: #ddd; border-radius: 3px; }
        #qz-table-wrap table { width: 100%; border-collapse: collapse; font-size: 12px; }
        #qz-table-wrap th {
            background: #fafafa; padding: 9px 10px; text-align: left;
            position: sticky; top: 0; z-index: 1; font-weight: 600;
            color: #999; font-size: 11px; border-bottom: 1px solid #f0f0f0;
        }
        #qz-table-wrap td {
            padding: 7px 10px; border-top: 1px solid #f5f5f5;
            max-width: 200px; word-break: break-all; color: #333;
        }
        #qz-table-wrap tr:hover td { background: #fafafa; }
        #qz-table-wrap td:first-child { color: #ccc; font-size: 11px; }

        .qz-export-btns { display: flex; gap: 8px; }
        .qz-export-btns .qz-btn { flex: unset; }
    `);

    const fab = document.createElement('button');
    fab.id = 'qz-fab';
    fab.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    fab.title = 'QQ空间动态获取';
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'qz-panel';
    panel.innerHTML = `
        <div id="qz-panel-header">
            <span class="qz-title">QQ空间动态获取</span>
            <button id="qz-close">×</button>
        </div>
        <div id="qz-body">
            <div class="qz-section">
                <div class="qz-section-title">目标</div>
                <div class="qz-row">
                    <span class="qz-label">QQ</span>
                    <input class="qz-input" id="qz-target" placeholder="输入好友 QQ 号">
                </div>
            </div>

            <div class="qz-section">
                <div class="qz-section-title">配置</div>
                <div class="qz-config-grid">
                    <div class="qz-config-item">
                        <label>最大页数</label>
                        <input type="number" id="qz-maxpages" value="100" min="1">
                    </div>
                    <div class="qz-config-item">
                        <label>每页条数</label>
                        <input type="number" id="qz-pagesize" value="20" min="1" max="40">
                    </div>
                    <div class="qz-config-item">
                        <label>间隔 (ms)</label>
                        <input type="number" id="qz-delay" value="1500" min="500" step="100">
                    </div>
                </div>
            </div>

            <div class="qz-section">
                <div class="qz-section-title">筛选</div>
                <div class="qz-filters">
                    <div class="qz-switch-wrap">
                        <label class="qz-switch">
                            <input type="checkbox" id="qz-include-img" checked>
                            <span class="qz-switch-slider"></span>
                        </label>
                        <span>纯图片</span>
                    </div>
                    <div class="qz-switch-wrap">
                        <label class="qz-switch">
                            <input type="checkbox" id="qz-include-video">
                            <span class="qz-switch-slider"></span>
                        </label>
                        <span>视频</span>
                    </div>
                </div>
            </div>

            <div class="qz-action-row" style="margin-bottom:14px">
                <button class="qz-btn qz-btn-primary" id="qz-start">开始获取</button>
                <button class="qz-btn qz-btn-danger" id="qz-stop" disabled>停止</button>
            </div>

            <div id="qz-progress-wrap"><div id="qz-progress-bar"></div></div>
            <div id="qz-log"></div>

            <div id="qz-stats" style="display:none">
                <div class="qz-stat"><div class="qz-stat-val" id="qz-s-total">0</div><div class="qz-stat-label">总动态</div></div>
                <div class="qz-stat"><div class="qz-stat-val" id="qz-s-text">0</div><div class="qz-stat-label">有文案</div></div>
                <div class="qz-stat"><div class="qz-stat-val" id="qz-s-img">0</div><div class="qz-stat-label">有图片</div></div>
                <div class="qz-stat"><div class="qz-stat-val" id="qz-s-video">0</div><div class="qz-stat-label">有视频</div></div>
            </div>

            <div id="qz-table-wrap" style="display:none"></div>

            <div class="qz-export-btns" id="qz-export-btns" style="display:none">
                <button class="qz-btn qz-btn-ghost qz-btn-sm" id="qz-export-json">JSON</button>
                <button class="qz-btn qz-btn-ghost qz-btn-sm" id="qz-export-csv">CSV</button>
                <button class="qz-btn qz-btn-primary qz-btn-sm" id="qz-download-imgs">下载图片</button>
                <button class="qz-btn qz-btn-ghost qz-btn-sm" id="qz-clear">清空</button>
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    const targetInput = document.getElementById('qz-target');
    const maxPagesInput = document.getElementById('qz-maxpages');
    const pageSizeInput = document.getElementById('qz-pagesize');
    const delayInput = document.getElementById('qz-delay');
    const includeImgCheck = document.getElementById('qz-include-img');
    const includeVideoCheck = document.getElementById('qz-include-video');
    const startBtn = document.getElementById('qz-start');
    const stopBtn = document.getElementById('qz-stop');
    const progressBar = document.getElementById('qz-progress-bar');
    const logDiv = document.getElementById('qz-log');
    const statsDiv = document.getElementById('qz-stats');
    const tableWrap = document.getElementById('qz-table-wrap');
    const exportBtns = document.getElementById('qz-export-btns');

    const urlMatch = location.pathname.match(/\/(\d{5,12})/);
    if (urlMatch) {
        targetInput.value = urlMatch[1];
    }

    let allFeeds = [];
    let running = false;

    fab.addEventListener('click', () => {
        panel.classList.toggle('open');
    });

    document.getElementById('qz-close').addEventListener('click', () => {
        panel.classList.remove('open');
    });

    let dragging = false, dragX, dragY;
    const header = document.getElementById('qz-panel-header');
    header.addEventListener('mousedown', (e) => {
        if (e.target.id === 'qz-close') return;
        dragging = true;
        dragX = e.clientX - panel.offsetLeft;
        dragY = e.clientY - panel.offsetTop;
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        panel.style.left = (e.clientX - dragX) + 'px';
        panel.style.top = (e.clientY - dragY) + 'px';
        panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    function log(msg) {
        const line = document.createElement('div');
        line.textContent = msg;
        logDiv.appendChild(line);
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    function updateStats() {
        const total = allFeeds.length;
        const textCount = allFeeds.filter(f => f.content && !f.content.match(/^\(\d+张图片\)$/) && f.content !== '(视频)').length;
        const imgCount = allFeeds.filter(f => f.images && f.images.length > 0).length;
        const videoCount = allFeeds.filter(f => f.videoUrl).length;
        document.getElementById('qz-s-total').textContent = total;
        document.getElementById('qz-s-text').textContent = textCount;
        document.getElementById('qz-s-img').textContent = imgCount;
        document.getElementById('qz-s-video').textContent = videoCount;
    }

    function renderTable() {
        if (allFeeds.length === 0) {
            tableWrap.style.display = 'none';
            exportBtns.style.display = 'none';
            statsDiv.style.display = 'none';
            return;
        }
        statsDiv.style.display = 'flex';
        tableWrap.style.display = 'block';
        exportBtns.style.display = 'flex';

        let h = '<table><thead><tr><th>#</th><th>昵称</th><th>文案内容</th><th>媒体</th><th>时间</th></tr></thead><tbody>';
        allFeeds.forEach((f, i) => {
            const safe = (f.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const name = (f.nickname || '-').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const media = [];
            if (f.images && f.images.length) media.push(`${f.images.length}图`);
            if (f.videoUrl) media.push('视频');
            h += `<tr><td>${i + 1}</td><td>${name}</td><td>${safe}</td><td>${media.join(' ') || '-'}</td><td>${f.time || ''}</td></tr>`;
        });
        h += '</tbody></table>';
        tableWrap.innerHTML = h;
        updateStats();
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function parseJsonpData(text) {
        const inner = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
        try {
            return new Function('return (' + inner + ')')();
        } catch {
            const fixed = inner
                .replace(/undefined/g, 'null')
                .replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"')
                .replace(/(?<=[{,\s])(\w+)\s*:/g, '"$1":');
            return JSON.parse(fixed);
        }
    }

    async function startFetch() {
        const hostUin = targetInput.value.trim();
        if (!hostUin) { alert('请输入目标QQ号'); return; }

        const pSkey = getCookie('p_skey');
        const uin = getCookie('uin').replace(/^o/, '') || getCookie('p_uin').replace(/^o/, '');
        if (!pSkey) { alert('未检测到 p_skey Cookie，请确认已登录QQ空间'); return; }
        if (!uin) { alert('未检测到 uin Cookie，请确认已登录QQ空间'); return; }

        const gTk = calcGtk(pSkey);
        const maxPages = parseInt(maxPagesInput.value) || 100;
        const pageSize = parseInt(pageSizeInput.value) || 20;
        const delay = parseInt(delayInput.value) || 1500;

        running = true;
        allFeeds = [];
        logDiv.innerHTML = '';
        startBtn.disabled = true;
        stopBtn.disabled = false;
        progressBar.style.width = '0%';

        const filterDesc = [];
        filterDesc.push(includeImgCheck.checked ? '纯图片 ON' : '纯图片 OFF');
        filterDesc.push(includeVideoCheck.checked ? '视频 ON' : '视频 OFF');
        log(`QQ: ${uin} → ${hostUin}  g_tk: ${gTk}`);
        log(`开始获取 ${hostUin} 的空间动态...`);
        log(`最大页数: ${maxPages}  每页: ${pageSize}  间隔: ${delay}ms  ${filterDesc.join(' | ')}`);

        const seenKeys = new Set();
        const baseUrl = 'https://user.qzone.qq.com/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds_html_act_all';

        for (let page = 0; page < maxPages; page++) {
            if (!running) { log('用户手动停止'); break; }

            const start = page * pageSize;
            const params = new URLSearchParams({
                uin, hostuin: hostUin, scope: '0', filter: 'all', flag: '1',
                refresh: '0', firstGetGroup: '0', mixnocache: '0', scene: '0',
                begintime: 'undefined', icServerTime: '', start: String(start),
                count: String(pageSize), sidomain: 'qzonestyle.gtimg.cn',
                useutf8: '1', outputhtmlfeed: '1', refer: '2',
                r: String(Math.random()), g_tk: String(gTk)
            });

            let text;
            try {
                const resp = await fetch(`${baseUrl}?${params}`, { credentials: 'include' });
                text = await resp.text();
            } catch (e) {
                log(`[错误] 第${page + 1}页请求失败: ${e.message}`);
                break;
            }

            let data;
            try {
                data = parseJsonpData(text);
            } catch (e) {
                log(`[错误] 第${page + 1}页解析失败: ${e.message}`);
                break;
            }

            const friendData = data?.data?.friend_data;
            if (!friendData || friendData.length === 0) {
                log(`第${page + 1}页无更多数据，结束`);
                break;
            }

            let newCount = 0;
            for (const item of friendData) {
                if (!item) continue;
                const feed = extractFeedData(item.html);
                const hasText = feed.content && feed.content.trim();
                const hasImages = feed.images.length > 0;
                const hasVideo = !!feed.videoUrl;

                let displayContent = feed.content || '';
                if (!displayContent && hasImages) displayContent = `(${feed.images.length}张图片)`;
                if (!displayContent && hasVideo) displayContent = '(视频)';

                if (!hasText && hasImages && !includeImgCheck.checked) continue;
                if (!hasText && hasVideo && !includeVideoCheck.checked) continue;

                const time = item.feedstime || '';
                const key = time + '|' + (displayContent || '').slice(0, 50);
                if (seenKeys.has(key)) continue;
                seenKeys.add(key);
                newCount++;
                allFeeds.push({
                    nickname: item.nickname || '',
                    uin: item.uin || '',
                    content: displayContent,
                    time,
                    appid: item.appid || '',
                    typeid: item.typeid || '',
                    images: feed.images,
                    videoUrl: feed.videoUrl,
                });
            }

            log(`第${page + 1}页: ${friendData.length}条, 新增${newCount}, 累计${allFeeds.length}`);
            progressBar.style.width = `${Math.min(((page + 1) / maxPages) * 100, 100)}%`;
            renderTable();

            if (newCount === 0 && page > 0) {
                log('本页无新数据，结束');
                break;
            }

            await sleep(delay);
        }

        const textCount = allFeeds.filter(f => f.content && !f.content.match(/^\(\d+张图片\)$/) && f.content !== '(视频)').length;
        const imgCount = allFeeds.filter(f => f.images && f.images.length > 0).length;
        const videoCount = allFeeds.filter(f => f.videoUrl).length;
        log(`完成 共${allFeeds.length}条, 文案${textCount}, 图片${imgCount}, 视频${videoCount}`);
        progressBar.style.width = '100%';
        startBtn.disabled = false;
        stopBtn.disabled = true;
        running = false;
        renderTable();
    }

    stopBtn.addEventListener('click', () => { running = false; });

    startBtn.addEventListener('click', startFetch);

    document.getElementById('qz-export-json').addEventListener('click', () => {
        if (!allFeeds.length) return;
        downloadFile(JSON.stringify(allFeeds, null, 2), `qzone_${targetInput.value}_feeds.json`, 'application/json');
    });

    document.getElementById('qz-export-csv').addEventListener('click', () => {
        if (!allFeeds.length) return;
        downloadFile(toCSV(allFeeds), `qzone_${targetInput.value}_feeds.csv`, 'text/csv');
    });

    function downloadImage(url, name) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                headers: { Accept: 'image/jpeg,image/png,image/*;q=0.8' },
                responseType: 'blob',
                onload(resp) {
                    const blob = resp.response;
                    if (blob.type.includes('webp')) {
                        const img = new Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            canvas.width = img.width;
                            canvas.height = img.height;
                            canvas.getContext('2d').drawImage(img, 0, 0);
                            canvas.toBlob(jpegBlob => {
                                const blobUrl = URL.createObjectURL(jpegBlob);
                                const a = document.createElement('a');
                                a.href = blobUrl;
                                a.download = name;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                                URL.revokeObjectURL(img.src);
                                resolve();
                            }, 'image/jpeg', 0.95);
                        };
                        img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('webp decode failed')); };
                        img.src = URL.createObjectURL(blob);
                    } else {
                        const blobUrl = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = blobUrl;
                        a.download = name;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                        resolve();
                    }
                },
                onerror(e) { reject(e); },
            });
        });
    }

    document.getElementById('qz-download-imgs').addEventListener('click', async () => {
        const urls = [];
        allFeeds.forEach(f => {
            (f.images || []).forEach(u => { if (!urls.includes(u)) urls.push(u); });
        });
        if (!urls.length) { log('没有可下载的图片'); return; }

        const dlBtn = document.getElementById('qz-download-imgs');
        dlBtn.disabled = true;
        dlBtn.textContent = '下载中...';
        log(`开始下载 ${urls.length} 张原图...`);

        let ok = 0, fail = 0;
        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            let name;
            const boM = url.match(/bo=([^&]+)/);
            if (boM) {
                name = boM[1].slice(0, 20) + '_' + String(i + 1).padStart(4, '0') + '.jpg';
            } else {
                name = 'img_' + String(i + 1).padStart(4, '0') + '.jpg';
            }

            try {
                await downloadImage(url, name);
                ok++;
            } catch (e) {
                fail++;
            }

            if ((i + 1) % 5 === 0 || i === urls.length - 1) {
                log(`下载进度: ${i + 1}/${urls.length} (成功${ok}, 失败${fail})`);
            }
            await sleep(300);
        }

        log(`图片下载完成! 成功${ok}, 失败${fail}`);
        dlBtn.disabled = false;
        dlBtn.textContent = '下载图片';
    });

    document.getElementById('qz-clear').addEventListener('click', () => {
        allFeeds = [];
        logDiv.innerHTML = '';
        tableWrap.innerHTML = '';
        tableWrap.style.display = 'none';
        exportBtns.style.display = 'none';
        statsDiv.style.display = 'none';
        progressBar.style.width = '0%';
    });
})();
