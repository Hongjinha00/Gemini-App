// 스크린샷 범위 선택 UI 스크립트
(function() {
  'use strict';
  
  try {
    // 이미 스크린샷 모드가 활성화되어 있으면 제거 (토글)
    const existingToolbar = document.getElementById('screenshot-toolbar');
    const existingStyles = document.getElementById('screenshot-styles');
  
  if (existingToolbar || existingStyles) {
    console.log('Screenshot mode: Cleaning up existing UI');
    if (existingToolbar) existingToolbar.remove();
    if (existingStyles) existingStyles.remove();
    document.querySelectorAll('.screenshot-selectable').forEach(el => {
      el.classList.remove('screenshot-selectable', 'screenshot-in-range', 'screenshot-start', 'screenshot-end');
      el.style.outline = '';
      el.style.backgroundColor = '';
    });
    if (window.electronScreenshot) {
      window.electronScreenshot.endMode();
    }
    return;
  }

  console.log('Screenshot mode: Initializing...');

  // 스타일 주입
  const style = document.createElement('style');
  style.id = 'screenshot-styles';
  style.textContent = `
    .screenshot-selectable {
      cursor: pointer !important;
      position: relative !important;
    }
    .screenshot-selectable::after {
      content: '' !important;
      position: absolute !important;
      top: 0 !important;
      left: -50vw !important;
      right: -50vw !important;
      bottom: 0 !important;
      pointer-events: none !important;
      transition: background-color 0.15s ease !important;
      z-index: 10 !important;
    }
    .screenshot-selectable:hover {
      outline: 2px dashed #8ab4f8 !important;
      outline-offset: 2px !important;
      z-index: 11 !important;
    }
    .screenshot-in-range::after {
      background-color: rgba(138, 180, 248, 0.2) !important;
    }
    .screenshot-start::after,
    .screenshot-end::after {
      background-color: rgba(138, 180, 248, 0.3) !important;
    }
    .screenshot-start.screenshot-end::after {
      background-color: rgba(138, 180, 248, 0.3) !important;
    }
    #screenshot-toolbar {
      position: fixed !important;
      bottom: 10px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      background: #202124 !important;
      border: 1px solid #5f6368 !important;
      border-radius: 8px !important;
      padding: 8px 12px !important;
      display: flex !important;
      flex-direction: row !important;
      gap: 8px !important;
      align-items: center !important;
      z-index: 2147483647 !important;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif !important;
    }
    #screenshot-toolbar * {
      font-family: inherit !important;
      box-sizing: border-box !important;
    }
    #screenshot-toolbar .toolbar-status {
      color: #9aa0a6 !important;
      font-size: 12px !important;
      white-space: nowrap !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    #screenshot-toolbar button {
      padding: 6px 12px !important;
      border: none !important;
      border-radius: 4px !important;
      cursor: pointer !important;
      font-size: 12px !important;
      font-weight: 500 !important;
      transition: all 0.15s ease !important;
      margin: 0 !important;
      white-space: nowrap !important;
    }
    #screenshot-toolbar .btn-capture {
      background: #8ab4f8 !important;
      color: #202124 !important;
    }
    #screenshot-toolbar .btn-capture:hover:not(:disabled) {
      background: #aecbfa !important;
    }
    #screenshot-toolbar .btn-capture:disabled {
      background: #3c4043 !important;
      color: #5f6368 !important;
      cursor: not-allowed !important;
    }
    #screenshot-toolbar .btn-reset {
      background: #3c4043 !important;
      color: #e3e3e3 !important;
    }
    #screenshot-toolbar .btn-reset:hover {
      background: #5f6368 !important;
    }
    #screenshot-toolbar .btn-cancel {
      background: transparent !important;
      color: #f28b82 !important;
      border: 1px solid #5f6368 !important;
    }
    #screenshot-toolbar .btn-cancel:hover {
      background: rgba(242, 139, 130, 0.1) !important;
      border-color: #f28b82 !important;
    }
  `;
  document.head.appendChild(style);

  // 메시지 요소 찾기
  let messages = [];
  
  // Gemini: user-query와 model-response 커스텀 엘리먼트
  const userQueries = Array.from(document.querySelectorAll('user-query'));
  const modelResponses = Array.from(document.querySelectorAll('model-response'));
  
  console.log('Screenshot: Found', userQueries.length, 'user queries,', modelResponses.length, 'model responses');
  
  if (userQueries.length > 0 || modelResponses.length > 0) {
    // DOM 순서대로 정렬
    messages = [...userQueries, ...modelResponses].sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }
  
  // AI Studio 대응
  if (messages.length === 0) {
    messages = Array.from(document.querySelectorAll('.turn-content, .message-content, [data-turn-id]'));
  }
  
  if (messages.length === 0) {
    alert('캡처할 채팅 메시지를 찾을 수 없습니다.\n채팅이 있는 페이지에서 시도해주세요.');
    style.remove();
    if (window.electronScreenshot) window.electronScreenshot.endMode();
    return;
  }
  
  console.log('Screenshot: Total', messages.length, 'messages found');

  // 상태 관리
  let startIndex = -1;
  let endIndex = -1;
  const clickHandlers = new Map();

  // 툴바 생성 (DOM API 사용 - Trusted Types CSP 대응)
  const toolbar = document.createElement('div');
  toolbar.id = 'screenshot-toolbar';
  
  const statusEl = document.createElement('span');
  statusEl.className = 'toolbar-status';
  statusEl.textContent = '시작점 클릭';
  toolbar.appendChild(statusEl);
  
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn-reset';
  resetBtn.textContent = '다시';
  resetBtn.style.display = 'none';
  toolbar.appendChild(resetBtn);
  
  const captureBtn = document.createElement('button');
  captureBtn.type = 'button';
  captureBtn.className = 'btn-capture';
  captureBtn.textContent = '캡처';
  captureBtn.disabled = true;
  toolbar.appendChild(captureBtn);
  
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-cancel';
  cancelBtn.textContent = '취소';
  toolbar.appendChild(cancelBtn);
  
  document.body.appendChild(toolbar);

  // 메시지 클릭 이벤트 핸들러 설정
  messages.forEach((msg, idx) => {
    msg.classList.add('screenshot-selectable');
    
    const handler = function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      if (startIndex === -1) {
        // 시작점 선택
        startIndex = idx;
        msg.classList.add('screenshot-start', 'screenshot-in-range');
        statusEl.textContent = '끝점 클릭';
        resetBtn.style.display = 'inline-block';
      } else if (endIndex === -1) {
        // 끝점 선택
        endIndex = idx;
        
        // 시작/끝 순서 정렬
        if (startIndex > endIndex) {
          [startIndex, endIndex] = [endIndex, startIndex];
        }
        
        // 범위 내 모든 메시지 표시
        messages.forEach((m, i) => {
          m.classList.remove('screenshot-start', 'screenshot-end', 'screenshot-in-range');
          if (i >= startIndex && i <= endIndex) {
            m.classList.add('screenshot-in-range');
          }
        });
        messages[startIndex].classList.add('screenshot-start');
        messages[endIndex].classList.add('screenshot-end');
        
        const count = endIndex - startIndex + 1;
        statusEl.textContent = count + '개 선택';
        captureBtn.disabled = false;
      }
    };
    
    msg.addEventListener('click', handler, true);
    clickHandlers.set(msg, handler);
  });

  // 다시 선택 버튼
  resetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    startIndex = -1;
    endIndex = -1;
    
    messages.forEach(m => {
      m.classList.remove('screenshot-in-range', 'screenshot-start', 'screenshot-end');
    });
    
    statusEl.textContent = '시작점 클릭';
    captureBtn.disabled = true;
    resetBtn.style.display = 'none';
  });

  // 캡처 버튼
  captureBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (startIndex === -1 || endIndex === -1) return;
    
    const selectedMsgs = messages.slice(startIndex, endIndex + 1);
    statusEl.textContent = '준비 중...';
    
    // UI 숨기기
    toolbar.style.display = 'none';
    messages.forEach(m => {
      m.classList.remove('screenshot-selectable', 'screenshot-start', 'screenshot-end', 'screenshot-in-range');
      m.style.outline = 'none';
    });
    
    // 1. 창 최대화
    let windowMaximized = false;
    if (window.electronScreenshot) {
      const result = await window.electronScreenshot.maximizeForCapture();
      windowMaximized = result?.success;
      await new Promise(r => setTimeout(r, 300));
    }
    
    // 2. Gemini 고정 UI 요소들 숨기기
    const fixedElements = [];
    const selectorsToHide = [
      'input-area-v2', '.input-area', '[class*="input-area"]',
      '.bottom-container', '[class*="bottom-container"]',
      '.chat-input', '.scroll-to-bottom',
      '[class*="floating"]', '[class*="sticky"]',
      'footer', '.disclaimer', '[class*="disclaimer"]',
      '[class*="gradient"]', '[class*="fade"]',
      '[class*="overlay"]', '.gmat-caption',
      '[class*="scroll-button"]', '[class*="new-message"]',
      'mat-sidenav', '.side-navigation', 'aside',
      'header:not(:has(user-query)):not(:has(model-response))'
    ];
    
    selectorsToHide.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => {
          if (el.offsetHeight > 0 || el.offsetWidth > 0) {
            if (!selectedMsgs.some(m => el.contains(m) || m.contains(el))) {
              fixedElements.push({ el, cssText: el.style.cssText });
              el.style.cssText += 'display: none !important; visibility: hidden !important;';
            }
          }
        });
      } catch (e) {}
    });
    
    // position: fixed/sticky 요소 숨기기
    document.querySelectorAll('*').forEach(el => {
      try {
        const style = getComputedStyle(el);
        if ((style.position === 'fixed' || style.position === 'sticky') && el.offsetHeight > 0) {
          if (!selectedMsgs.some(m => el.contains(m) || m.contains(el))) {
            fixedElements.push({ el, cssText: el.style.cssText });
            el.style.cssText += 'display: none !important;';
          }
        }
      } catch (e) {}
    });
    
    await new Promise(r => setTimeout(r, 200));
    
    // 3. 스크롤 컨테이너 찾기
    let scrollContainer = null;
    let parent = selectedMsgs[0].parentElement;
    while (parent) {
      const style = getComputedStyle(parent);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        scrollContainer = parent;
        break;
      }
      parent = parent.parentElement;
    }
    if (!scrollContainer) scrollContainer = document.documentElement;
    
    // 4. 선택된 메시지들의 X 좌표 범위 계산 (첫 메시지 기준)
    const firstMsg = selectedMsgs[0];
    const lastMsg = selectedMsgs[selectedMsgs.length - 1];
    
    // 첫 메시지로 스크롤
    firstMsg.scrollIntoView({ block: 'start', behavior: 'instant' });
    await new Promise(r => setTimeout(r, 200));
    
    // X 좌표 계산 (모든 선택된 메시지에서)
    let minX = Infinity, maxX = 0;
    selectedMsgs.forEach(m => {
      const rect = m.getBoundingClientRect();
      minX = Math.min(minX, rect.left);
      maxX = Math.max(maxX, rect.right);
    });
    const padding = 5;
    minX = Math.max(0, minX - padding);
    maxX = maxX + padding;
    const captureWidth = Math.ceil(maxX - minX);
    
    // 5. 캡처 루프
    const captures = [];
    const viewportHeight = window.innerHeight;
    let captureCount = 0;
    const maxCaptures = 50;
    let done = false;
    
    while (!done && captureCount < maxCaptures) {
      await new Promise(r => setTimeout(r, 150));
      
      // 현재 화면에서 선택된 메시지들의 Y 영역 계산
      let captureMinY = viewportHeight;
      let captureMaxY = 0;
      let hasVisibleSelected = false;
      
      for (const m of selectedMsgs) {
        const rect = m.getBoundingClientRect();
        // 화면에 일부라도 보이는지 확인
        if (rect.bottom > 0 && rect.top < viewportHeight) {
          hasVisibleSelected = true;
          captureMinY = Math.min(captureMinY, Math.max(0, rect.top));
          captureMaxY = Math.max(captureMaxY, Math.min(viewportHeight, rect.bottom));
        }
      }
      
      if (!hasVisibleSelected) {
        // 아직 선택된 메시지가 안 보이면 스크롤
        const firstRect = firstMsg.getBoundingClientRect();
        if (firstRect.top >= viewportHeight) {
          scrollContainer.scrollBy(0, viewportHeight - 50);
          continue;
        }
        break;
      }
      
      // 캡처 영역 조정
      captureMinY = Math.max(0, captureMinY - padding);
      captureMaxY = Math.min(viewportHeight, captureMaxY + padding);
      
      if (captureMaxY > captureMinY) {
        // 캡처 실행
        const imageData = await window.electronScreenshot.captureArea({
          x: Math.floor(minX),
          y: Math.floor(captureMinY),
          width: captureWidth,
          height: Math.ceil(captureMaxY - captureMinY)
        });
        
        if (imageData) {
          captures.push({ data: imageData, height: Math.ceil(captureMaxY - captureMinY) });
        }
      }
      
      captureCount++;
      
      // 마지막 메시지가 완전히 보이면 종료
      const lastRect = lastMsg.getBoundingClientRect();
      if (lastRect.bottom <= viewportHeight - padding) {
        done = true;
        break;
      }
      
      // 다음 영역으로 스크롤
      const scrollAmount = Math.max(100, captureMaxY - captureMinY - 30);
      const prevScroll = scrollContainer.scrollTop;
      scrollContainer.scrollBy(0, scrollAmount);
      await new Promise(r => setTimeout(r, 50));
      
      // 스크롤이 안 됐으면 종료
      if (scrollContainer.scrollTop === prevScroll) {
        done = true;
      }
    }
    
    console.log('Screenshot: Captured', captures.length, 'images');
    
    // 6. 고정 요소 복원
    fixedElements.forEach(({ el, cssText }) => {
      el.style.cssText = cssText;
    });
    
    // 7. 창 복원
    if (windowMaximized && window.electronScreenshot) {
      await window.electronScreenshot.restoreAfterCapture();
    }
    
    // 8. 이미지 합치기 및 저장
    if (captures.length > 0) {
      await window.electronScreenshot.mergeAndSave(captures);
    } else {
      alert('캡처된 이미지가 없습니다.');
    }
    
    cleanup();
  });

  // 취소 버튼
  cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cleanup();
  });

  // ESC 키 핸들러
  function escHandler(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      cleanup();
    }
  }
  document.addEventListener('keydown', escHandler, true);
  window.addEventListener('keydown', escHandler, true);

  // 정리 함수
  function cleanup() {
    console.log('Screenshot mode: Cleaning up');
    
    document.removeEventListener('keydown', escHandler, true);
    window.removeEventListener('keydown', escHandler, true);
    
    messages.forEach(m => {
      const handler = clickHandlers.get(m);
      if (handler) {
        m.removeEventListener('click', handler, true);
      }
      m.classList.remove('screenshot-selectable', 'screenshot-in-range', 'screenshot-start', 'screenshot-end');
      m.style.outline = '';
    });
    clickHandlers.clear();
    
    toolbar.remove();
    style.remove();
    
    if (window.electronScreenshot) {
      window.electronScreenshot.endMode();
    }
  }

  console.log('Screenshot mode: Ready with', messages.length, 'messages');
  } catch (error) {
    console.error('Screenshot mode error:', error);
    alert('스크린샷 모드 초기화 실패: ' + error.message);
  }
})();
