// ==UserScript==
// @name         YouTube Search Sorter
// @namespace    https://github.com/SDavid33
// @version      1.0.2
// @description  Builds a clean sorted view for loaded YouTube search videos by newest, oldest, or views.
// @author       David33
// @match        https://www.youtube.com/results*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const KEYS = {
        sortMode: 'yt_search_sorter_mode',
        autoRebuild: 'yt_search_sorter_auto_rebuild',
        autoOpen: 'yt_search_sorter_auto_open',
        dimOriginal: 'yt_search_sorter_dim_original'
    };

    const IDS = {
        topButton: 'yt-search-sorter-top-button',
        fallbackButton: 'yt-search-sorter-floating-button',
        panel: 'yt-search-sorter-settings-panel',
        style: 'yt-search-sorter-style',
        sortedBox: 'yt-search-sorter-results-box',
        dimStyle: 'yt-search-sorter-dim-original-style'
    };

    const KOFI = {
        url: 'https://ko-fi.com/N4N0XO52O',
        label: 'Support me on Ko-fi',
        color: '#72a4f2'
    };

    let rebuildTimer = null;
    let autoOpenTimer = null;
    let clickLock = false;
    let lastVideoSignature = '';
    let lastUrl = location.href;

    function isSearchPage() {
        return location.hostname === 'www.youtube.com' && location.pathname === '/results';
    }

    function getSortMode() {
        return GM_getValue(KEYS.sortMode, 'newest');
    }

    function setSortMode(mode) {
        GM_setValue(KEYS.sortMode, mode);
    }

    function getAutoRebuild() {
        return GM_getValue(KEYS.autoRebuild, true);
    }

    function setAutoRebuild(value) {
        GM_setValue(KEYS.autoRebuild, Boolean(value));
    }

    function getAutoOpen() {
        return GM_getValue(KEYS.autoOpen, true);
    }

    function setAutoOpen(value) {
        GM_setValue(KEYS.autoOpen, Boolean(value));
    }

    function getDimOriginal() {
        return GM_getValue(KEYS.dimOriginal, false);
    }

    function setDimOriginal(value) {
        GM_setValue(KEYS.dimOriginal, Boolean(value));
    }

    function notify(message) {
        console.log('[YouTube Search Sorter]', message);

        try {
            GM_notification({
                title: 'YouTube Search Sorter',
                text: message,
                timeout: 2200
            });
        } catch {
            console.log(message);
        }
    }

    function normalizeText(text) {
        return String(text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getSearchQuery() {
        return new URLSearchParams(location.search).get('search_query') || '';
    }

    function cleanDateOperators(query) {
        return query
            .replace(/\s+after:\d{4}-\d{2}-\d{2}/gi, '')
            .replace(/\s+before:\d{4}-\d{2}-\d{2}/gi, '')
            .replace(/^after:\d{4}-\d{2}-\d{2}\s*/gi, '')
            .replace(/^before:\d{4}-\d{2}-\d{2}\s*/gi, '')
            .trim();
    }

    function daysAgo(days) {
        const date = new Date();
        date.setDate(date.getDate() - days);

        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');

        return `${y}-${m}-${d}`;
    }

    function applyAfterDays(days) {
        const url = new URL(location.href);
        const cleanQuery = cleanDateOperators(getSearchQuery());

        url.searchParams.set('search_query', `${cleanQuery} after:${daysAgo(days)}`.trim());
        url.searchParams.delete('sp');

        location.href = url.toString();
    }

    function clearDateFilter() {
        const url = new URL(location.href);
        url.searchParams.set('search_query', cleanDateOperators(getSearchQuery()));
        url.searchParams.delete('sp');
        location.href = url.toString();
    }

    function tryYouTubeUploadDateSort() {
        const url = new URL(location.href);
        url.searchParams.set('sp', 'CAI=');
        location.href = url.toString();
    }

    function getVideoUrlFromElement(videoEl) {
        const link = videoEl.querySelector('a[href*="/watch?v="]');
        if (!link) return '';

        try {
            const url = new URL(link.href);
            const videoId = url.searchParams.get('v');
            return videoId ? `https://www.youtube.com/watch?v=${videoId}` : '';
        } catch {
            return link.href.split('&')[0];
        }
    }

    function getVideoIdFromUrl(url) {
        try {
            return new URL(url).searchParams.get('v') || '';
        } catch {
            return '';
        }
    }

    function getTitleFromElement(videoEl) {
        const titleNode =
            videoEl.querySelector('#video-title') ||
            videoEl.querySelector('a[href*="/watch?v="][title]') ||
            videoEl.querySelector('h3 a');

        return normalizeText(
            titleNode?.getAttribute('title') ||
            titleNode?.textContent ||
            ''
        );
    }

    function getChannelFromElement(videoEl) {
        const channelNode =
            videoEl.querySelector('ytd-channel-name a') ||
            videoEl.querySelector('#channel-info a') ||
            videoEl.querySelector('a[href^="/@"]') ||
            videoEl.querySelector('a[href^="/channel/"]');

        return normalizeText(channelNode?.textContent || '');
    }

    function getThumbFromElement(videoEl, videoUrl) {
        const img =
            videoEl.querySelector('img[src*="ytimg"]') ||
            videoEl.querySelector('img');

        const src = img?.src || img?.getAttribute('src') || '';

        if (src && !src.startsWith('data:')) {
            return src;
        }

        const videoId = getVideoIdFromUrl(videoUrl);
        return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
    }

    function looksLikeViews(text) {
        const raw = normalizeText(text).toLowerCase();

        return (
            /views?/.test(raw) ||
            /megtekint/.test(raw) ||
            /조회수/.test(raw) ||
            /visualizaciones/.test(raw) ||
            /vistas/.test(raw) ||
            /vues/.test(raw) ||
            /aufrufe/.test(raw)
        );
    }

    function looksLikeAge(text) {
        const raw = normalizeText(text).toLowerCase();

        return (
            /just now/.test(raw) ||
            /\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago/.test(raw) ||
            /\d+\s+(másodperc|perc|óra|nap|hét|hete|hónap|év|éve)/.test(raw) ||
            /\d+\s*(초|분|시간|일|주|개월|년)\s*전/.test(raw)
        );
    }

    function getMetaPartsFromElement(videoEl) {
        const spanCandidates = Array.from(videoEl.querySelectorAll(
            '#metadata-line span, ytd-video-meta-block span, #metadata span, .ytd-video-meta-block span'
        ))
            .map(node => normalizeText(node.textContent))
            .filter(Boolean);

        let viewsText = spanCandidates.find(looksLikeViews) || '';
        let ageText = spanCandidates.find(looksLikeAge) || '';

        const lines = String(videoEl.innerText || '')
            .split('\n')
            .map(line => normalizeText(line))
            .filter(Boolean);

        const combinedLine = lines.find(line => looksLikeViews(line) && looksLikeAge(line));

        if (!viewsText) viewsText = lines.find(looksLikeViews) || combinedLine || '';
        if (!ageText) ageText = lines.find(looksLikeAge) || combinedLine || '';

        return {
            viewsText,
            ageText,
            combinedText: normalizeText([viewsText, ageText].filter(Boolean).join(' • ')) || combinedLine || ''
        };
    }

    function parseAgeToMinutes(text) {
        if (!text) return Number.MAX_SAFE_INTEGER;

        const raw = normalizeText(text).toLowerCase();

        if (
            raw.includes('just now') ||
            raw.includes('seconds ago') ||
            raw.includes('second ago')
        ) {
            return 0;
        }

        const en = raw.match(/(\d+(?:\.\d+)?)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
        if (en) {
            const value = Number(en[1]);
            const unit = en[2];

            if (unit === 'second') return value / 60;
            if (unit === 'minute') return value;
            if (unit === 'hour') return value * 60;
            if (unit === 'day') return value * 60 * 24;
            if (unit === 'week') return value * 60 * 24 * 7;
            if (unit === 'month') return value * 60 * 24 * 30;
            if (unit === 'year') return value * 60 * 24 * 365;
        }

        const hu = raw.match(/(\d+(?:[.,]\d+)?)\s+(másodperc|perc|óra|nap|hét|hete|hónap|év|éve)/);
        if (hu) {
            const value = Number(hu[1].replace(',', '.'));
            const unit = hu[2];

            if (unit.includes('másodperc')) return value / 60;
            if (unit.includes('perc')) return value;
            if (unit.includes('óra')) return value * 60;
            if (unit.includes('nap')) return value * 60 * 24;
            if (unit.includes('hét') || unit.includes('hete')) return value * 60 * 24 * 7;
            if (unit.includes('hónap')) return value * 60 * 24 * 30;
            if (unit.includes('év') || unit.includes('éve')) return value * 60 * 24 * 365;
        }

        const ko = raw.match(/(\d+(?:[.,]\d+)?)\s*(초|분|시간|일|주|개월|년)\s*전/);
        if (ko) {
            const value = Number(ko[1].replace(',', '.'));
            const unit = ko[2];

            if (unit === '초') return value / 60;
            if (unit === '분') return value;
            if (unit === '시간') return value * 60;
            if (unit === '일') return value * 60 * 24;
            if (unit === '주') return value * 60 * 24 * 7;
            if (unit === '개월') return value * 60 * 24 * 30;
            if (unit === '년') return value * 60 * 24 * 365;
        }

        return Number.MAX_SAFE_INTEGER;
    }

    function parseViews(text) {
        if (!text) return 0;

        const raw = normalizeText(text).toLowerCase().replace(/,/g, '');

        const en = raw.match(/([\d.]+)\s*([kmb])?\s+views?/);
        if (en) {
            const num = Number(en[1]);
            const suffix = en[2];

            if (suffix === 'k') return num * 1_000;
            if (suffix === 'm') return num * 1_000_000;
            if (suffix === 'b') return num * 1_000_000_000;

            return num;
        }

        const compactEn = raw.match(/([\d.]+)\s*([kmb])\b/);
        if (compactEn && looksLikeViews(raw)) {
            const num = Number(compactEn[1]);
            const suffix = compactEn[2];

            if (suffix === 'k') return num * 1_000;
            if (suffix === 'm') return num * 1_000_000;
            if (suffix === 'b') return num * 1_000_000_000;
        }

        const hu = raw.match(/([\d.,]+)\s*([em])?\s+megtekint/i);
        if (hu) {
            const num = Number(hu[1].replace(',', '.'));
            const suffix = hu[2];

            if (suffix === 'e') return num * 1_000;
            if (suffix === 'm') return num * 1_000_000;

            return num;
        }

        const ko = raw.match(/조회수\s*([\d.,]+)\s*([천만억])?/i);
        if (ko) {
            const num = Number(ko[1].replace(',', '.'));
            const suffix = ko[2];

            if (suffix === '천') return num * 1_000;
            if (suffix === '만') return num * 10_000;
            if (suffix === '억') return num * 100_000_000;

            return num;
        }

        return 0;
    }

    function formatAgeLabel(ageMinutes, originalAgeText = '') {
        if (originalAgeText) return originalAgeText;

        if (!Number.isFinite(ageMinutes) || ageMinutes === Number.MAX_SAFE_INTEGER) {
            return 'unknown date';
        }

        if (ageMinutes < 60) return `${Math.max(1, Math.round(ageMinutes))} min ago`;
        if (ageMinutes < 1440) return `${Math.round(ageMinutes / 60)} hours ago`;
        if (ageMinutes < 10080) return `${Math.round(ageMinutes / 1440)} days ago`;
        if (ageMinutes < 43200) return `${Math.round(ageMinutes / 10080)} weeks ago`;
        if (ageMinutes < 525600) return `${Math.round(ageMinutes / 43200)} months ago`;

        return `${Math.round(ageMinutes / 525600)} years ago`;
    }

    function formatViews(views, originalViewsText = '') {
        if (originalViewsText) return originalViewsText;

        if (!views || views <= 0) return 'unknown views';
        if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)}B views`;
        if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M views`;
        if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K views`;

        return `${Math.round(views)} views`;
    }

    function collectLoadedVideos() {
        const elements = Array.from(document.querySelectorAll('ytd-video-renderer'));
        const map = new Map();

        for (const el of elements) {
            if (el.offsetParent === null) continue;

            const url = getVideoUrlFromElement(el);
            const id = getVideoIdFromUrl(url);
            const title = getTitleFromElement(el);

            if (!url || !id || !title) continue;

            const meta = getMetaPartsFromElement(el);
            const age = parseAgeToMinutes(meta.ageText || meta.combinedText);
            const views = parseViews(meta.viewsText || meta.combinedText);
            const channel = getChannelFromElement(el);
            const thumb = getThumbFromElement(el, url);

            if (!map.has(id)) {
                map.set(id, {
                    id,
                    url,
                    title,
                    channel,
                    thumb,
                    age,
                    views,
                    viewsText: meta.viewsText,
                    ageText: meta.ageText,
                    metadata: meta.combinedText
                });
            }
        }

        return Array.from(map.values());
    }

    function sortVideos(videos, mode = getSortMode()) {
        return videos.slice().sort((a, b) => {
            if (mode === 'newest') {
                if (a.age !== b.age) return a.age - b.age;
                return b.views - a.views;
            }

            if (mode === 'oldest') {
                if (a.age !== b.age) return b.age - a.age;
                return b.views - a.views;
            }

            if (mode === 'views') {
                if (a.views !== b.views) return b.views - a.views;
                return a.age - b.age;
            }

            return 0;
        });
    }

    function getLoadedSignature(videos) {
        return videos.map(v => `${v.id}:${v.age}:${v.views}`).join('|');
    }

    function injectStyle() {
        if (document.getElementById(IDS.style)) return;

        const style = document.createElement('style');
        style.id = IDS.style;
        style.textContent = `
            #${IDS.topButton} {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                height: 36px !important;
                padding: 0 14px !important;
                margin-left: 0 !important;
                margin-right: 10px !important;
                border-radius: 18px !important;
                background: var(--yt-spec-badge-chip-background, rgba(255,255,255,.1)) !important;
                color: var(--yt-spec-text-primary, #fff) !important;
                font-family: Roboto, Arial, sans-serif !important;
                font-size: 14px !important;
                font-weight: 600 !important;
                cursor: pointer !important;
                user-select: none !important;
                white-space: nowrap !important;
            }

            #${IDS.topButton}:hover {
                background: var(--yt-spec-button-chip-background-hover, rgba(255,255,255,.18)) !important;
            }

            #${IDS.fallbackButton} {
                position: fixed !important;
                right: 18px !important;
                bottom: 18px !important;
                z-index: 2147483647 !important;
                padding: 10px 13px !important;
                border-radius: 999px !important;
                background: #3ea6ff !important;
                color: #061018 !important;
                font-family: Roboto, Arial, sans-serif !important;
                font-size: 13px !important;
                font-weight: 800 !important;
                cursor: pointer !important;
                box-shadow: 0 8px 24px rgba(0,0,0,.45) !important;
                user-select: none !important;
                pointer-events: auto !important;
            }

            #${IDS.panel} {
                position: fixed !important;
                right: 18px !important;
                top: 62px !important;
                bottom: auto !important;
                z-index: 2147483647 !important;
                width: 340px !important;
                max-height: calc(100vh - 82px) !important;
                overflow-y: auto !important;
                padding: 14px !important;
                border-radius: 16px !important;
                background: rgba(22, 22, 22, .98) !important;
                border: 1px solid rgba(255,255,255,.18) !important;
                color: #fff !important;
                font-family: Roboto, Arial, sans-serif !important;
                box-shadow: 0 10px 34px rgba(0,0,0,.55) !important;
                box-sizing: border-box !important;
                pointer-events: auto !important;
            }

            #${IDS.panel} .yt-ss-header {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                margin-bottom: 12px !important;
            }

            #${IDS.panel} .yt-ss-title {
                font-size: 15px !important;
                font-weight: 800 !important;
            }

            #${IDS.panel} .yt-ss-close {
                width: 28px !important;
                height: 28px !important;
                border-radius: 999px !important;
                border: none !important;
                background: rgba(255,255,255,.12) !important;
                color: #fff !important;
                cursor: pointer !important;
                font-size: 16px !important;
            }

            #${IDS.panel} .yt-ss-section {
                margin-top: 12px !important;
                padding-top: 12px !important;
                border-top: 1px solid rgba(255,255,255,.1) !important;
            }

            #${IDS.panel} .yt-ss-section.no-border {
                border-top: none !important;
                padding-top: 0 !important;
                margin-top: 0 !important;
            }

            #${IDS.panel} .yt-ss-label {
                font-size: 12px !important;
                color: #aaa !important;
                margin-bottom: 7px !important;
                font-weight: 700 !important;
            }

            #${IDS.panel} .yt-ss-row {
                display: flex !important;
                flex-wrap: wrap !important;
                gap: 7px !important;
            }

            #${IDS.panel} button,
            #${IDS.sortedBox} button {
                border: none !important;
                border-radius: 999px !important;
                padding: 8px 11px !important;
                background: rgba(255,255,255,.13) !important;
                color: #fff !important;
                cursor: pointer !important;
                font-size: 12px !important;
                font-weight: 650 !important;
            }

            #${IDS.panel} button.active,
            #${IDS.sortedBox} button.active {
                background: #3ea6ff !important;
                color: #07111a !important;
            }

            #${IDS.panel} button.danger,
            #${IDS.sortedBox} button.danger {
                background: rgba(255, 70, 70, .18) !important;
            }

            #${IDS.panel} .yt-ss-status {
                margin-top: 12px !important;
                padding: 8px 10px !important;
                border-radius: 10px !important;
                background: rgba(255,255,255,.08) !important;
                font-size: 12px !important;
                color: #bbb !important;
                line-height: 1.35 !important;
            }

            #${IDS.panel} .yt-ss-kofi {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                margin-top: 10px !important;
                padding: 9px 12px !important;
                border-radius: 12px !important;
                background: ${KOFI.color} !important;
                color: #07111a !important;
                font-size: 13px !important;
                font-weight: 800 !important;
                text-decoration: none !important;
                text-align: center !important;
            }

            #${IDS.panel} .yt-ss-kofi:hover {
                filter: brightness(1.08) !important;
            }

            #${IDS.sortedBox} {
                margin: 12px 0 24px 0 !important;
                padding: 16px !important;
                border-radius: 18px !important;
                background: rgba(25,25,25,.98) !important;
                border: 1px solid rgba(255,255,255,.14) !important;
                color: #fff !important;
                font-family: Roboto, Arial, sans-serif !important;
                box-sizing: border-box !important;
            }

            #${IDS.sortedBox} .yt-ss-box-header {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                gap: 12px !important;
                margin-bottom: 12px !important;
            }

            #${IDS.sortedBox} .yt-ss-box-title {
                font-size: 20px !important;
                font-weight: 800 !important;
            }

            #${IDS.sortedBox} .yt-ss-box-subtitle {
                margin-top: 4px !important;
                color: #aaa !important;
                font-size: 12px !important;
            }

            #${IDS.sortedBox} .yt-ss-box-actions {
                display: flex !important;
                flex-wrap: wrap !important;
                gap: 8px !important;
            }

            #${IDS.sortedBox} .yt-ss-list {
                display: flex !important;
                flex-direction: column !important;
                gap: 12px !important;
            }

            #${IDS.sortedBox} .yt-ss-card {
                display: grid !important;
                grid-template-columns: 220px 1fr !important;
                gap: 14px !important;
                padding: 10px !important;
                border-radius: 14px !important;
                background: rgba(255,255,255,.055) !important;
                color: #fff !important;
                text-decoration: none !important;
            }

            #${IDS.sortedBox} .yt-ss-card:hover {
                background: rgba(255,255,255,.09) !important;
            }

            #${IDS.sortedBox} .yt-ss-thumb {
                width: 220px !important;
                aspect-ratio: 16 / 9 !important;
                border-radius: 10px !important;
                object-fit: cover !important;
                background: #111 !important;
            }

            #${IDS.sortedBox} .yt-ss-video-title {
                font-size: 16px !important;
                line-height: 1.35 !important;
                font-weight: 800 !important;
                color: #fff !important;
                margin-bottom: 8px !important;
            }

            #${IDS.sortedBox} .yt-ss-meta {
                font-size: 13px !important;
                color: #aaa !important;
                line-height: 1.45 !important;
            }

            #${IDS.sortedBox} .yt-ss-rank {
                display: inline-block !important;
                margin-right: 8px !important;
                padding: 2px 7px !important;
                border-radius: 999px !important;
                background: rgba(62,166,255,.22) !important;
                color: #8cccff !important;
                font-size: 12px !important;
                font-weight: 800 !important;
            }

            @media (max-width: 800px) {
                #${IDS.sortedBox} .yt-ss-card {
                    grid-template-columns: 1fr !important;
                }

                #${IDS.sortedBox} .yt-ss-thumb {
                    width: 100% !important;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function makeButton(label, action, extraClass = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.dataset.action = action;

        if (extraClass) {
            button.className = extraClass;
        }

        return button;
    }

    function makeSection(label, buttons, noBorder = false) {
        const section = document.createElement('div');
        section.className = noBorder ? 'yt-ss-section no-border' : 'yt-ss-section';

        const labelEl = document.createElement('div');
        labelEl.className = 'yt-ss-label';
        labelEl.textContent = label;

        const row = document.createElement('div');
        row.className = 'yt-ss-row';

        buttons.forEach(button => row.appendChild(button));

        section.appendChild(labelEl);
        section.appendChild(row);

        return section;
    }

    function ensureButtons() {
        if (!isSearchPage()) {
            document.getElementById(IDS.topButton)?.remove();
            document.getElementById(IDS.fallbackButton)?.remove();
            document.getElementById(IDS.panel)?.remove();
            document.getElementById(IDS.sortedBox)?.remove();
            removeDimOriginalStyle();
            return;
        }

        injectStyle();

        const mastheadEnd =
            document.querySelector('ytd-masthead #end') ||
            document.querySelector('#end.ytd-masthead') ||
            document.querySelector('ytd-masthead');

        let topButton = document.getElementById(IDS.topButton);

        if (mastheadEnd) {
            if (!topButton) {
                topButton = document.createElement('div');
                topButton.id = IDS.topButton;
                topButton.textContent = 'YT Sorter';
                topButton.title = 'YouTube Search Sorter';
                topButton.setAttribute('role', 'button');
                topButton.setAttribute('tabindex', '0');

                mastheadEnd.insertBefore(topButton, mastheadEnd.firstChild);
            }

            document.getElementById(IDS.fallbackButton)?.remove();
        } else {
            let fallbackButton = document.getElementById(IDS.fallbackButton);

            if (!fallbackButton) {
                fallbackButton = document.createElement('div');
                fallbackButton.id = IDS.fallbackButton;
                fallbackButton.textContent = 'YT Sorter';
                fallbackButton.setAttribute('role', 'button');
                fallbackButton.setAttribute('tabindex', '0');
                document.body.appendChild(fallbackButton);
            }
        }

        applyDimOriginalStyle();
    }

    function toggleSettingsPanel() {
        const existing = document.getElementById(IDS.panel);

        if (existing) {
            existing.remove();
            return;
        }

        createSettingsPanel();
    }

    function createSettingsPanel() {
        injectStyle();

        document.getElementById(IDS.panel)?.remove();

        const autoOpen = getAutoOpen();
        const autoRebuild = getAutoRebuild();
        const dimOriginal = getDimOriginal();
        const mode = getSortMode();

        const panel = document.createElement('div');
        panel.id = IDS.panel;

        const header = document.createElement('div');
        header.className = 'yt-ss-header';

        const title = document.createElement('div');
        title.className = 'yt-ss-title';
        title.textContent = 'YouTube Search Sorter';

        const close = makeButton('×', 'close', 'yt-ss-close');

        header.appendChild(title);
        header.appendChild(close);

        const buildNow = makeButton('Build sorted view', 'build-now');
        const removeView = makeButton('Remove view', 'remove-view', 'danger');

        const newest = makeButton('Newest', 'mode-newest', mode === 'newest' ? 'active' : '');
        const oldest = makeButton('Oldest', 'mode-oldest', mode === 'oldest' ? 'active' : '');
        const views = makeButton('Most views', 'mode-views', mode === 'views' ? 'active' : '');

        const autoOpenOn = makeButton('ON', 'auto-open-on', autoOpen ? 'active' : '');
        const autoOpenOff = makeButton('OFF', 'auto-open-off', !autoOpen ? 'active' : '');

        const autoOn = makeButton('ON', 'auto-on', autoRebuild ? 'active' : '');
        const autoOff = makeButton('OFF', 'auto-off', !autoRebuild ? 'active' : '');

        const dimOn = makeButton('Dim original ON', 'dim-on', dimOriginal ? 'active' : '');
        const dimOff = makeButton('Dim original OFF', 'dim-off', !dimOriginal ? 'active' : '');

        const ytUpload = makeButton('Try YT upload sort', 'yt-upload');
        const lastDay = makeButton('Last 24h', 'last-day');
        const lastWeek = makeButton('Last 7d', 'last-week');
        const lastMonth = makeButton('Last 30d', 'last-month');
        const clear = makeButton('Clear date', 'clear-date', 'danger');

        const status = document.createElement('div');
        status.className = 'yt-ss-status';

        const kofi = document.createElement('a');
        kofi.className = 'yt-ss-kofi';
        kofi.href = KOFI.url;
        kofi.target = '_blank';
        kofi.rel = 'noopener noreferrer';
        kofi.textContent = KOFI.label;

        panel.appendChild(header);
        panel.appendChild(makeSection('Sorted view', [buildNow, removeView], true));
        panel.appendChild(makeSection('Auto open sorted view', [autoOpenOn, autoOpenOff]));
        panel.appendChild(makeSection('Sort mode', [newest, oldest, views]));
        panel.appendChild(makeSection('Auto rebuild when more videos load', [autoOn, autoOff]));
        panel.appendChild(makeSection('Original YouTube results', [dimOn, dimOff]));
        panel.appendChild(makeSection('YouTube/date filters', [ytUpload, lastDay, lastWeek, lastMonth, clear]));
        panel.appendChild(status);
        panel.appendChild(kofi);

        document.body.appendChild(panel);
        updateStatus();
    }

    function findInsertTarget() {
        const possibleTargets = [
            'ytd-search ytd-section-list-renderer',
            'ytd-search #primary',
            'ytd-search',
            '#contents.ytd-section-list-renderer'
        ];

        for (const selector of possibleTargets) {
            const el = document.querySelector(selector);
            if (el) return el;
        }

        return document.body;
    }

    function createSortedCard(video, index) {
        const card = document.createElement('a');
        card.className = 'yt-ss-card';
        card.href = video.url;

        const img = document.createElement('img');
        img.className = 'yt-ss-thumb';
        img.alt = '';
        img.loading = 'lazy';

        if (video.thumb) {
            img.src = video.thumb;
        }

        const info = document.createElement('div');

        const title = document.createElement('div');
        title.className = 'yt-ss-video-title';

        const rank = document.createElement('span');
        rank.className = 'yt-ss-rank';
        rank.textContent = `#${index + 1}`;

        const titleText = document.createElement('span');
        titleText.textContent = video.title;

        title.appendChild(rank);
        title.appendChild(titleText);

        const meta = document.createElement('div');
        meta.className = 'yt-ss-meta';

        const channel = document.createElement('div');
        channel.textContent = video.channel ? `Channel: ${video.channel}` : 'Channel: unknown';

        const stats = document.createElement('div');
        stats.textContent = `${formatViews(video.views, video.viewsText)} • ${formatAgeLabel(video.age, video.ageText)}`;

        const raw = document.createElement('div');
        raw.textContent = video.metadata ? `Original meta: ${video.metadata}` : '';

        info.appendChild(title);
        info.appendChild(meta);
        meta.appendChild(channel);
        meta.appendChild(stats);

        if (video.metadata) {
            meta.appendChild(raw);
        }

        card.appendChild(img);
        card.appendChild(info);

        return card;
    }

    function buildSortedView(silent = false) {
        if (!isSearchPage()) {
            if (!silent) notify('Open a YouTube search results page first.');
            return;
        }

        injectStyle();

        const loaded = collectLoadedVideos();
        const sorted = sortVideos(loaded, getSortMode());

        if (!sorted.length) {
            if (!silent) notify('No loaded videos found. Scroll a little, then try again.');
            return;
        }

        applyDimOriginalStyle();

        document.getElementById(IDS.sortedBox)?.remove();

        const box = document.createElement('section');
        box.id = IDS.sortedBox;

        const header = document.createElement('div');
        header.className = 'yt-ss-box-header';

        const titleWrap = document.createElement('div');

        const title = document.createElement('div');
        title.className = 'yt-ss-box-title';
        title.textContent = 'Sorted Results';

        const unknownDates = sorted.filter(v => v.age === Number.MAX_SAFE_INTEGER).length;

        const subtitle = document.createElement('div');
        subtitle.className = 'yt-ss-box-subtitle';
        subtitle.textContent = `${sorted.length} loaded videos sorted by ${getSortMode()}. Unknown dates: ${unknownDates}. Scroll down to load more, then rebuild.`;

        titleWrap.appendChild(title);
        titleWrap.appendChild(subtitle);

        const actions = document.createElement('div');
        actions.className = 'yt-ss-box-actions';

        const newest = makeButton('Newest', 'mode-newest', getSortMode() === 'newest' ? 'active' : '');
        const oldest = makeButton('Oldest', 'mode-oldest', getSortMode() === 'oldest' ? 'active' : '');
        const views = makeButton('Most views', 'mode-views', getSortMode() === 'views' ? 'active' : '');
        const rebuild = makeButton('Rebuild', 'build-now');
        const dimToggle = makeButton(getDimOriginal() ? 'Original normal' : 'Dim original', getDimOriginal() ? 'dim-off' : 'dim-on');
        const close = makeButton('Close', 'remove-view', 'danger');

        actions.appendChild(newest);
        actions.appendChild(oldest);
        actions.appendChild(views);
        actions.appendChild(rebuild);
        actions.appendChild(dimToggle);
        actions.appendChild(close);

        header.appendChild(titleWrap);
        header.appendChild(actions);

        const list = document.createElement('div');
        list.className = 'yt-ss-list';

        sorted.forEach((video, index) => {
            list.appendChild(createSortedCard(video, index));
        });

        box.appendChild(header);
        box.appendChild(list);

        box.addEventListener('click', event => {
            const button = event.target.closest('button[data-action]');
            if (!button) return;

            event.preventDefault();
            event.stopPropagation();

            handlePanelAction(button.dataset.action);
        }, true);

        const target = findInsertTarget();
        target.prepend(box);

        lastVideoSignature = getLoadedSignature(loaded);

        if (!silent) {
            notify(`Built sorted view with ${sorted.length} loaded videos.`);
            createSettingsPanel();
        } else {
            updateStatus();
        }
    }

    function removeSortedView() {
        document.getElementById(IDS.sortedBox)?.remove();
        removeDimOriginalStyle();
        updateStatus();

        if (document.getElementById(IDS.panel)) {
            createSettingsPanel();
        }
    }

    function applyDimOriginalStyle() {
        removeDimOriginalStyle();

        if (!getDimOriginal()) return;

        const style = document.createElement('style');
        style.id = IDS.dimStyle;
        style.textContent = `
            ytd-search ytd-video-renderer {
                opacity: 0.16 !important;
                filter: grayscale(1) brightness(0.55) !important;
                pointer-events: none !important;
            }

            ytd-search ytd-reel-shelf-renderer,
            ytd-search ytd-shelf-renderer,
            ytd-search ytd-horizontal-card-list-renderer {
                opacity: 0.16 !important;
                filter: grayscale(1) brightness(0.55) !important;
                pointer-events: none !important;
            }
        `;

        document.head.appendChild(style);
    }

    function removeDimOriginalStyle() {
        document.getElementById(IDS.dimStyle)?.remove();
    }

    function scheduleAutoRebuild() {
        if (!getAutoRebuild()) return;
        if (!isSearchPage()) return;

        clearTimeout(rebuildTimer);

        rebuildTimer = setTimeout(() => {
            const videos = collectLoadedVideos();
            const signature = getLoadedSignature(videos);

            if (!videos.length) return;

            if (signature === lastVideoSignature) {
                updateStatus();
                return;
            }

            if (document.getElementById(IDS.sortedBox)) {
                buildSortedView(true);
            }

            lastVideoSignature = signature;
        }, 1200);
    }

    function scheduleAutoOpenSortedView() {
        clearTimeout(autoOpenTimer);

        if (!getAutoOpen()) return;
        if (!isSearchPage()) return;

        autoOpenTimer = setTimeout(() => {
            if (!isSearchPage()) return;

            const loaded = collectLoadedVideos();

            if (!loaded.length) {
                setTimeout(scheduleAutoOpenSortedView, 1000);
                return;
            }

            if (!document.getElementById(IDS.sortedBox)) {
                buildSortedView(true);
            }
        }, 1400);
    }

    function handlePanelAction(action) {
        if (action === 'close') {
            document.getElementById(IDS.panel)?.remove();
            return;
        }

        if (action === 'build-now') {
            buildSortedView(false);
            return;
        }

        if (action === 'remove-view') {
            removeSortedView();
            return;
        }

        if (action === 'auto-open-on') {
            setAutoOpen(true);
            if (document.getElementById(IDS.panel)) createSettingsPanel();
            scheduleAutoOpenSortedView();
            return;
        }

        if (action === 'auto-open-off') {
            setAutoOpen(false);
            if (document.getElementById(IDS.panel)) createSettingsPanel();
            return;
        }

        if (action === 'mode-newest') {
            setSortMode('newest');
            if (document.getElementById(IDS.sortedBox)) buildSortedView(true);
            if (document.getElementById(IDS.panel)) createSettingsPanel();
            return;
        }

        if (action === 'mode-oldest') {
            setSortMode('oldest');
            if (document.getElementById(IDS.sortedBox)) buildSortedView(true);
            if (document.getElementById(IDS.panel)) createSettingsPanel();
            return;
        }

        if (action === 'mode-views') {
            setSortMode('views');
            if (document.getElementById(IDS.sortedBox)) buildSortedView(true);
            if (document.getElementById(IDS.panel)) createSettingsPanel();
            return;
        }

        if (action === 'auto-on') {
            setAutoRebuild(true);
            if (document.getElementById(IDS.panel)) createSettingsPanel();
            scheduleAutoRebuild();
            return;
        }

        if (action === 'auto-off') {
            setAutoRebuild(false);
            if (document.getElementById(IDS.panel)) createSettingsPanel();
            return;
        }

        if (action === 'dim-on') {
            setDimOriginal(true);
            applyDimOriginalStyle();
            if (document.getElementById(IDS.sortedBox)) buildSortedView(true);
            if (document.getElementById(IDS.panel)) createSettingsPanel();
            return;
        }

        if (action === 'dim-off') {
            setDimOriginal(false);
            removeDimOriginalStyle();
            if (document.getElementById(IDS.sortedBox)) buildSortedView(true);
            if (document.getElementById(IDS.panel)) createSettingsPanel();
            return;
        }

        if (action === 'yt-upload') tryYouTubeUploadDateSort();
        if (action === 'last-day') applyAfterDays(1);
        if (action === 'last-week') applyAfterDays(7);
        if (action === 'last-month') applyAfterDays(30);
        if (action === 'clear-date') clearDateFilter();

        updateStatus();
    }

    function globalClickHandler(event) {
        const panel = document.getElementById(IDS.panel);

        const sortButton =
            event.target.closest(`#${IDS.topButton}`) ||
            event.target.closest(`#${IDS.fallbackButton}`);

        const panelButton = event.target.closest(`#${IDS.panel} button[data-action]`);
        const clickedInsidePanel = panel && panel.contains(event.target);

        if (panel && !clickedInsidePanel && !sortButton) {
            panel.remove();
            return;
        }

        if (!sortButton && !panelButton) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (sortButton) {
            if (clickLock) return;
            clickLock = true;

            setTimeout(() => {
                clickLock = false;
            }, 250);

            toggleSettingsPanel();
            return;
        }

        if (panelButton) {
            handlePanelAction(panelButton.dataset.action);
        }
    }

    function updateStatus() {
        const status = document.querySelector(`#${IDS.panel} .yt-ss-status`);
        if (!status) return;

        const loadedVideos = collectLoadedVideos();
        const loaded = loadedVideos.length;
        const unknownDates = loadedVideos.filter(v => v.age === Number.MAX_SAFE_INTEGER).length;
        const sortedOpen = document.getElementById(IDS.sortedBox) ? 'open' : 'closed';
        const autoOpen = getAutoOpen() ? 'ON' : 'OFF';
        const auto = getAutoRebuild() ? 'ON' : 'OFF';
        const dimmed = getDimOriginal() ? 'dimmed' : 'normal';

        status.textContent = `Loaded: ${loaded} | Unknown dates: ${unknownDates} | Sorted: ${sortedOpen} | Auto open: ${autoOpen} | Mode: ${getSortMode()} | Auto rebuild: ${auto} | Original: ${dimmed}`;
    }

    function registerCompactMenu() {
        // Tampermonkey popup commands intentionally disabled.
        // Settings are available from the YT Sorter button in the YouTube header.
    }

    function handleNavigationChange() {
        if (location.href === lastUrl) return;

        lastUrl = location.href;
        lastVideoSignature = '';

        document.getElementById(IDS.sortedBox)?.remove();

        setTimeout(ensureButtons, 300);
        setTimeout(scheduleAutoOpenSortedView, 1200);
    }

    function hookEvents() {
        document.addEventListener('click', globalClickHandler, true);
        document.addEventListener('pointerdown', globalClickHandler, true);

        window.addEventListener('scroll', scheduleAutoRebuild, { passive: true });

        window.addEventListener('yt-navigate-finish', () => {
            lastVideoSignature = '';
            setTimeout(ensureButtons, 300);
            setTimeout(scheduleAutoOpenSortedView, 1200);
        });

        setInterval(() => {
            handleNavigationChange();
            ensureButtons();
            updateStatus();
            scheduleAutoRebuild();
        }, 1500);
    }

    registerCompactMenu();
    hookEvents();

    setTimeout(ensureButtons, 100);
    setTimeout(ensureButtons, 500);
    setTimeout(ensureButtons, 1200);
    setTimeout(scheduleAutoOpenSortedView, 1600);
})();
