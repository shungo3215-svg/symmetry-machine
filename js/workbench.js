/* 日本語の制作作業面。幾何はapp.jsの既存経路、ここは配置・案の記録・操作の入口だけ。 */
(() => {
  'use strict';
  const api=window.SymmetryWorkbench, $=id=>document.getElementById(id);
  if (!api) return;
  const icons={"trash": "<svg aria-hidden=\"true\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M9.45442 3.08371C10.1295 2.40858 11.0452 2.0293 12 2.0293C12.9548 2.0293 13.8705 2.40858 14.5456 3.08371C15.2207 3.75884 15.6 4.67452 15.6 5.6293H14.4C14.4 4.99278 14.1471 4.38233 13.6971 3.93224C13.247 3.48215 12.6365 3.2293 12 3.2293C11.3635 3.2293 10.753 3.48215 10.3029 3.93224C9.85286 4.38233 9.6 4.99278 9.6 5.6293H8.4C8.4 4.67452 8.77928 3.75884 9.45442 3.08371ZM21 7.22931V8.42931H3V7.22931H21ZM17.3998 20.7993L17.3963 10.0295L18.5963 10.0291L18.5999 21.149C18.6001 21.6186 18.2195 21.9993 17.7499 21.9993H6.25C5.78056 21.9993 5.4 21.6187 5.4 21.1493L5.40018 10.0293L6.60018 10.0293L6.60001 20.7993H17.3998ZM9.4002 17.4993L9.4 11.4993L10.6 11.4993L10.6002 17.4993L9.4002 17.4993ZM13.3998 17.4993L13.4 11.4993L14.6 11.4993L14.5998 17.4993L13.3998 17.4993Z\" fill=\"black\"/>\n</svg>", "arrow-turn-left": "<svg aria-hidden=\"true\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M5.0849 8.67197L8.1807 5.57617L9.02923 6.4247L6.78091 8.67302H12.7114V9.87302H6.78092L9.02967 12.1218L8.18114 12.9703L5.0849 9.87406C4.75295 9.54211 4.75295 9.00392 5.0849 8.67197ZM14.3076 8.67296C15.6241 8.67296 16.8866 9.19592 17.8175 10.1268C18.7484 11.0577 19.2714 12.3202 19.2714 13.6367C19.2714 14.9532 18.7484 16.2157 17.8175 17.1466C16.8866 18.0775 15.6241 18.6004 14.3076 18.6004V17.4004C15.3058 17.4004 16.2632 17.0039 16.969 16.2981C17.6748 15.5922 18.0714 14.6349 18.0714 13.6367C18.0714 12.6385 17.6748 11.6812 16.969 10.9753C16.2632 10.2695 15.3058 9.87296 14.3076 9.87296V8.67296ZM8.63524 17.4004H12.7114V18.6004H8.63524V17.4004Z\" fill=\"currentColor\"/>\n</svg>\n", "arrow-turn-right": "<svg aria-hidden=\"true\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M17.2209 8.67302L14.9726 6.4247L15.8211 5.57617L18.9169 8.67197C19.2489 9.00392 19.2489 9.54211 18.9169 9.87406L15.8207 12.9703L14.9722 12.1218L17.2209 9.87302H11.2894V8.67302H17.2209ZM9.6942 9.87296C8.696 9.87296 7.73868 10.2695 7.03284 10.9753C6.327 11.6812 5.93047 12.6385 5.93047 13.6367C5.93047 14.6349 6.327 15.5922 7.03284 16.2981C7.73868 17.0039 8.696 17.4004 9.6942 17.4004V18.6004C8.37774 18.6004 7.11519 18.0775 6.18431 17.1466C5.25343 16.2157 4.73047 14.9532 4.73047 13.6367C4.73047 12.3202 5.25343 11.0577 6.18431 10.1268C7.11519 9.19592 8.37774 8.67296 9.6942 8.67296V9.87296ZM15.3666 18.6004H11.2894V17.4004H15.3666V18.6004Z\" fill=\"currentColor\"/>\n</svg>\n", "folder": "<svg aria-hidden=\"true\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M4.09844 5.89922V18.0992H19.8984V8.29921H10.1155C9.86327 8.29921 9.62404 8.18716 9.46254 7.99337L7.71741 5.89922H4.09844ZM2.89844 5.54922C2.89844 5.07978 3.279 4.69922 3.74844 4.69922H7.88134C8.13361 4.69922 8.37284 4.81127 8.53433 5.00506L10.2795 7.09921H20.2484C20.7179 7.09921 21.0984 7.47976 21.0984 7.94921V18.4492C21.0984 18.9186 20.7179 19.2992 20.2484 19.2992H3.74844C3.279 19.2992 2.89844 18.9186 2.89844 18.4492V5.54922Z\" fill=\"currentColor\"/>\n</svg>\n", "download": "<svg aria-hidden=\"true\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M11.399 14.5509L8.1805 11.3327L7.33201 12.1812L11.398 16.2469C11.398 16.2469 11.398 16.2469 11.398 16.2469C11.73 16.5788 12.2681 16.5788 12.6001 16.2469L16.6657 12.1813L15.8172 11.3328L12.599 14.5509L12.5987 2L11.3987 2.00002L11.399 14.5509ZM5.79358 5.79478C4.56638 7.02198 3.73064 8.58554 3.39205 10.2877C3.05347 11.9899 3.22724 13.7543 3.8914 15.3577C4.55556 16.9611 5.68027 18.3316 7.12331 19.2958C8.56635 20.26 10.2629 20.7746 11.9984 20.7746C13.734 20.7746 15.4305 20.26 16.8736 19.2958C18.3166 18.3316 19.4413 16.9611 20.1055 15.3577C20.7696 13.7543 20.9434 11.9899 20.6048 10.2877C20.2662 8.58554 19.4305 7.02198 18.2033 5.79478L19.0518 4.94625C20.4469 6.34128 21.3969 8.11865 21.7818 10.0536C22.1667 11.9886 21.9691 13.9942 21.2141 15.8169C20.4592 17.6396 19.1806 19.1975 17.5403 20.2935C15.8999 21.3896 13.9713 21.9746 11.9984 21.9746C10.0256 21.9746 8.09701 21.3896 6.45663 20.2935C4.81625 19.1975 3.53773 17.6396 2.78274 15.8169C2.02776 13.9942 1.83022 11.9886 2.21511 10.0536C2.6 8.11865 3.55003 6.34128 4.94505 4.94625L5.79358 5.79478Z\" fill=\"currentColor\"/>\n</svg>\n", "chevron-down": "<svg aria-hidden=\"true\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M18.0802 9.59657L12.6001 15.0767C12.2682 15.4086 11.73 15.4086 11.398 15.0767L11.8223 14.6524L11.398 15.0767L5.91797 9.59658L6.7665 8.74805L11.9991 13.9806L17.2317 8.74805L18.0802 9.59657Z\" fill=\"currentColor\"/>\n</svg>\n", "close": "<svg aria-hidden=\"true\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M11.1506 11.9992L5.21094 6.05947L6.05947 5.21094L11.9992 11.1506L17.9389 5.21094L18.7874 6.05947L12.8477 11.9992L18.7874 17.9389L17.9389 18.7874L11.9992 12.8477L6.05947 18.7874L5.21094 17.9389L11.1506 11.9992Z\" fill=\"currentColor\"/>\n</svg>\n", "cursor": "<svg aria-hidden=\"true\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M4.62387 5.65973C4.378 5.00123 5.02157 4.35941 5.6794 4.6071L18.6883 9.50521C19.3785 9.76509 19.4002 10.7335 18.7223 11.024L13.9181 13.0829L17.8804 17.0452L17.0319 17.8937L13.0696 13.9315L11.0115 18.7336C10.7206 19.4125 9.75033 19.3895 9.49197 18.6975L4.62387 5.65973ZM6.04142 6.02565L10.2834 17.3864L12.3157 12.6442C12.3764 12.5026 12.4893 12.3897 12.6309 12.3291L17.3786 10.2943L6.04142 6.02565ZM10.6162 18.2778L10.6159 18.2772Z\" fill=\"currentColor\"/>\n</svg>\n", "edit": "<svg aria-hidden=\"true\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M14.2898 5.14141C15.1684 4.26276 16.593 4.26276 17.4716 5.14141C18.3503 6.02005 18.3503 7.44462 17.4716 8.32327L17.342 8.4529L16.4935 7.60437L16.6231 7.47474L17.0474 7.899L16.6231 7.47474C17.0331 7.06472 17.0331 6.39995 16.6231 5.98994C16.2131 5.57992 15.5483 5.57992 15.1383 5.98994L15.0087 6.11956L14.1601 5.27104L14.2898 5.14141L14.714 5.56567L14.2898 5.14141ZM6.03885 15.0894L13.8799 7.24837L13.0313 6.39984L5.0917 14.3395C4.93792 14.4933 4.84893 14.7002 4.84305 14.9176L4.78806 16.9523L4.78806 16.9523C4.77489 17.4396 5.17341 17.8382 5.66071 17.825L7.69549 17.77C7.91289 17.7641 8.11978 17.6751 8.27356 17.5213L16.2132 9.5817L15.3647 8.73317L7.52365 16.5742L5.9976 16.6154L6.03885 15.0894ZM19.7852 20.1991H4.78516V18.9991H19.7852V20.1991Z\" fill=\"currentColor\"/>\n</svg>\n", "pencil": "<svg aria-hidden=\"true\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M15.3928 5.21268C16.33 4.27542 17.8496 4.27542 18.7869 5.21268C19.7242 6.14994 19.7242 7.66954 18.7869 8.60679L18.6455 8.74821L17.797 7.89969L17.9384 7.75827C18.407 7.28964 18.407 6.52984 17.9384 6.06121C17.4697 5.59258 16.7099 5.59258 16.2413 6.06121L16.0999 6.20263L15.2514 5.3541L15.3928 5.21268ZM6.29875 16.0038L14.9685 7.334L14.12 6.48547L5.3516 15.2539C5.19781 15.4077 5.10883 15.6145 5.10295 15.8319L5.04206 18.0849C5.02889 18.5722 5.42741 18.9707 5.91472 18.9575L8.16764 18.8966C8.38504 18.8908 8.59193 18.8018 8.74571 18.648L17.5141 9.87959L16.6656 9.03106L7.9958 17.7008L6.25161 17.748L6.29875 16.0038Z\" fill=\"currentColor\"/>\n</svg>\n", "apps-square": "<svg aria-hidden=\"true\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M3.64844 4.29922C3.64844 3.82978 4.029 3.44922 4.49844 3.44922H10.7484C11.2179 3.44922 11.5984 3.82978 11.5984 4.29922V10.5492C11.5984 11.0187 11.2179 11.3992 10.7484 11.3992H4.49844C4.02899 11.3992 3.64844 11.0187 3.64844 10.5492V4.29922ZM4.84844 4.64922V10.1992H10.3984V4.64922H4.84844ZM12.3984 4.29922C12.3984 3.82978 12.779 3.44922 13.2484 3.44922H19.4984C19.9679 3.44922 20.3484 3.82978 20.3484 4.29922V10.5492C20.3484 11.0187 19.9679 11.3992 19.4984 11.3992H13.2484C12.779 11.3992 12.3984 11.0187 12.3984 10.5492V4.29922ZM13.5984 4.64922V10.1992H19.1484V4.64922H13.5984ZM3.64844 13.4492C3.64844 12.9798 4.029 12.5992 4.49844 12.5992H10.7484C11.2179 12.5992 11.5984 12.9798 11.5984 13.4492V19.6992C11.5984 20.1687 11.2179 20.5492 10.7484 20.5492H4.49844C4.02899 20.5492 3.64844 20.1687 3.64844 19.6992V13.4492ZM4.84844 13.7992V19.3492H10.3984V13.7992H4.84844ZM12.3984 13.4492C12.3984 12.9798 12.779 12.5992 13.2484 12.5992H19.4984C19.9679 12.5992 20.3484 12.9798 20.3484 13.4492V19.6992C20.3484 20.1687 19.9679 20.5492 19.4984 20.5492H13.2484C12.779 20.5492 12.3984 20.1687 12.3984 19.6992V13.4492ZM13.5984 13.7992V19.3492H19.1484V13.7992H13.5984Z\" fill=\"currentColor\"/>\n</svg>\n", "more-horizontal": "<svg aria-hidden=\"true\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path d=\"M8.25 12C8.25 12.8284 7.57843 13.5 6.75 13.5C5.92157 13.5 5.25 12.8284 5.25 12C5.25 11.1716 5.92157 10.5 6.75 10.5C7.57843 10.5 8.25 11.1716 8.25 12Z\" fill=\"currentColor\"/>\n<path d=\"M13.5 12C13.5 12.8284 12.8284 13.5 12 13.5C11.1716 13.5 10.5 12.8284 10.5 12C10.5 11.1716 11.1716 10.5 12 10.5C12.8284 10.5 13.5 11.1716 13.5 12Z\" fill=\"currentColor\"/>\n<path d=\"M18.75 12C18.75 12.8284 18.0784 13.5 17.25 13.5C16.4216 13.5 15.75 12.8284 15.75 12C15.75 11.1716 16.4216 10.5 17.25 10.5C18.0784 10.5 18.75 11.1716 18.75 12Z\" fill=\"currentColor\"/>\n</svg>\n", "pin": "<svg aria-hidden=\"true\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M16.9522 5.32683C14.2179 2.59262 9.78489 2.59262 7.05068 5.32683C5.83081 6.5467 5.15519 8.10472 5.0238 9.69915H3.82031C3.95399 7.79698 4.74793 5.93252 6.20215 4.4783C9.40499 1.27546 14.5978 1.27546 17.8007 4.4783C19.2549 5.93252 20.0488 7.79698 20.1825 9.69915H18.979C18.8476 8.10472 18.172 6.5467 16.9522 5.32683ZM18.9283 11.2992C18.7174 12.737 18.0587 14.1218 16.9522 15.2283L12.0014 20.179L7.05068 15.2283C5.94413 14.1218 5.28541 12.737 5.07451 11.2992H3.86351C4.08154 13.0458 4.86108 14.7358 6.20215 16.0768L11.5738 21.4485C11.81 21.6847 12.1928 21.6847 12.429 21.4485L17.8007 16.0768C19.1417 14.7358 19.9213 13.0458 20.1393 11.2992H18.9283ZM12.0014 9.09913C11.2282 9.09913 10.6014 9.72593 10.6014 10.4991C10.6014 11.2723 11.2282 11.8991 12.0014 11.8991C12.7746 11.8991 13.4014 11.2723 13.4014 10.4991C13.4014 9.72593 12.7746 9.09913 12.0014 9.09913ZM9.40141 10.4991C9.40141 9.06319 10.5655 7.89913 12.0014 7.89913C13.4374 7.89913 14.6014 9.06319 14.6014 10.4991C14.6014 11.9351 13.4374 13.0991 12.0014 13.0991C10.5655 13.0991 9.40141 11.9351 9.40141 10.4991Z\" fill=\"currentColor\"/>\n</svg>\n"};
  const icon=name=>icons[name]||'';
  const make=(tag,cls,html='')=>{const e=document.createElement(tag);e.className=cls;e.innerHTML=html;return e;};
  const button=(text,action,ico)=>{const b=make('button','',`${ico?icon(ico):''}<span>${text}</span>`);b.type='button';b.onclick=action;return b;};
  const move=(id,host)=>{const e=$(id);if(e)host.append(e);return e;};
  const relabel=(id,label,ico)=>{const b=$(id);b.innerHTML=(ico?icon(ico):'')+`<span>${label}</span>`;b.setAttribute('aria-label',label);return b;};
  let messageTimer,returnFocus,resizeFrame,syncFrame;
  document.body.classList.add('workbench');
  const oldbar=document.querySelector('.appbar');
  const header=make('header','wb-header',`<span class="wb-wordmark">symmetry</span>`);
  oldbar.before(header);
  ['barUndo','barRedo'].forEach((id,i)=>{const b=move(id,header);relabel(id,i?'やり直す':'戻す',i?'arrow-turn-right':'arrow-turn-left');b.querySelector('span').hidden=true;b.classList.add('wb-icon-button');b.title=i?'やり直す（⌘⇧Z）':'戻す（⌘Z）';});
  {const b=move('barClear',header);relabel('barClear','全消去','trash');b.classList.add('wb-clear');b.title='ぜんぶ消す（⌘Zで戻せます）';}
  const fileButton=button('作品メニュー',()=>open('file'),'folder');fileButton.className='wb-icon-button';fileButton.querySelector('span').hidden=true;fileButton.setAttribute('aria-label','作品メニュー');fileButton.title='保存・開く・ヘルプ';header.append(fileButton);
  const exportButton=button('書き出す',()=>open('export'),'download');exportButton.className='wb-export';header.append(exportButton);
  const nav=make('nav','wb-nav');nav.setAttribute('aria-label','作業表示');header.after(nav);
  move('modebar',nav);
  relabel('modeLive','原画');relabel('modeEdit','展開');relabel('modeGrid','一覧');
  $('modebar').append($('modeLive'),$('modeEdit'),$('modeGrid'));
  const ruleButton=button('C6',()=>open('rules'),'chevron-down');ruleButton.id='wbRule';nav.append(ruleButton);
  const zoomButton=button('100%',()=>open('view'));zoomButton.id='wbZoom';nav.insertBefore(zoomButton,ruleButton);
  const art=make('div','');art.id='wbArt';nav.after(art);
  const layout=$('layout');art.append(layout);
  const context=make('div','');context.id='wbContext';
  const dock=make('nav','');dock.id='wbDock';dock.setAttribute('aria-label','描画の道具');
  const status=make('div','',`<span id="wbTarget"></span><span id="wbSaved">自動保存</span>`);status.id='wbStatus';
  art.after(status,context,dock);
  const dialog=make('dialog','',`<header class="wb-sheet-header"><h2 id="wbSheetTitle"></h2><button type="button" id="wbSheetClose" aria-label="閉じる">${icon('close')}</button></header><p id="wbFeedback" role="status" hidden></p><div id="wbSheetBody"></div>`);dialog.id='wbSheet';dialog.setAttribute('aria-labelledby','wbSheetTitle');document.body.append(dialog);
  const pages={},titles={style:'塗り・線・色',finish:'濃度・角丸',tools:'道具と描画設定',selection:'選択したものを編集',symmetry:'対称の設定',rules:'対称ルールを選ぶ',file:'作品を保存・開く',export:'書き出す',pins:'残した案を比べる',help:'操作ガイド',view:'表示の大きさと移動'};
  Object.keys(titles).forEach(k=>{const p=make('section','wb-page');p.dataset.page=k;pages[k]=p;$('wbSheetBody').append(p);});
  function open(name) {
    returnFocus=document.activeElement;
    Object.entries(pages).forEach(([k,p])=>p.classList.toggle('active',name===k));
    $('wbFeedback').hidden=true;dialog.dataset.page=name;$('wbSheetTitle').textContent=titles[name];$('wbSheetBody').scrollTop=0;
    if(name==='pins')renderPins();
    if(name==='rules')renderRules();
    if(name==='export')$('wbExportTarget').textContent=`書き出す案：${api.state().name}`;
    if(!dialog.open)dialog.showModal();
    $('wbSheetClose').focus();sync();
  }
  function close(){dialog.close();if(returnFocus&&returnFocus.isConnected)returnFocus.focus();}
  $('wbSheetClose').onclick=close;
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  dialog.addEventListener('keydown',e=>e.stopPropagation());
  // 既存要素を移す。IDとイベントは保ち、同名の操作状態を複製しない。
  move('grpDraw',pages.tools).open=true;
  move('grpStyle',pages.style).open=true;
  move('editbar',pages.selection);
  move('grpExpand',pages.symmetry).open=true;
  move('grpIO',pages.file).open=true;
  const styleExtra=$('subStyleMore');styleExtra.open=true;pages.finish.append(styleExtra);
  styleExtra.querySelector('summary').hidden=true;
  const colorRow=$('inkColor').closest('.prow');pages.style.append(colorRow);
  colorRow.querySelectorAll('input').forEach(e=>e.setAttribute('aria-label',e.id==='inkColor'?'インクの色':'紙の色'));
  pages.style.append(button('濃度・角丸を調整',()=>open('finish')));
  document.querySelectorAll('#grpStyle>.prow').forEach(row=>{if(!row.querySelector('button,input')&&!row.querySelector('#wChips'))row.hidden=true;});
  // 対称設定の常用項目はページを切り替え、縦に探させない。
  const sym=$('grpExpand'), symRows=[...sym.querySelectorAll(':scope > .prow')];
  const symTabs=make('div','wb-tabs');pages.symmetry.prepend(symTabs);
  const symNames=['配置','ガイド','重なり'];
  function symPage(n){symRows.forEach((r,i)=>r.hidden= !(n===0?i<2:n===1?i===2||i===3:i>=4));[...symTabs.children].forEach((b,i)=>b.setAttribute('aria-pressed',String(n===i)));$('etSnapWrap').hidden=n!==1;}
  symNames.forEach((name,i)=>symTabs.append(button(name,()=>symPage(i))));
  requestAnimationFrame(()=>symPage(0));
  $('tAxis').addEventListener('click',()=>{close();api.view('live');sync();resize();message('原画の上をタップして回転の中心を指定してください');});
  const ioExport=document.querySelector('#grpIO .exportRow');
  pages.export.innerHTML='<p id="wbExportTarget" class="wb-note"></p>';
  pages.export.append(ioExport);
  relabel('saveSvg','SVGで保存');relabel('savePng','PNGで保存');relabel('copySvg','SVGをコピー');
  const exportSettings=make('details','sub','<summary>メモ・PNG・その他の設定</summary>');
  [...ioExport.children].slice(1).forEach(e=>exportSettings.append(e));ioExport.append(exportSettings);
  const fileActions=make('div','wb-file-actions');pages.file.prepend(fileActions);
  move('jsonOut',fileActions);relabel('jsonOut','JSONで保存');
  ['file','jsonIn'].forEach(id=>{const input=$(id);const label=document.querySelector(`label[for="${id}"]`);label.tabIndex=0;label.setAttribute('role','button');label.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}};label.textContent=id==='file'?'SVG・画像を配置':'JSONを開く';fileActions.append(label,input);});
  $('grpIO').hidden=true;
  pages.file.append(button('残した案を比べる',()=>open('pins'),'pin'),button('操作ガイド',()=>open('help')));
  const cheat=$('cheat');cheat.hidden=false;move('cheatClose',oldbar);cheat.removeAttribute('id');cheat.style.cssText='position:static;display:block;max-height:none;width:auto;box-shadow:none;border:0;padding:0';pages.help.append(cheat);
  const live=$('live');live.querySelector('.grpTitle').textContent='いまの展開';
  // 編集面の説明・詳細は設定へ。主作業面はキャンバスだけ。
  [...$('edit').children].forEach(e=>{if(e.id!=='editCv'){pages.symmetry.append(e);e.classList.add('wb-edit-detail');}});
  document.querySelector('#editToolSeg').parentElement.hidden=true;
  ['etOptSelect','etOptAnchor','etOptShape','editHint'].forEach(id=>$(id).hidden=true);
  pages.symmetry.querySelectorAll('.grpTitle').forEach(e=>e.hidden=true);
  const cameras={live:{z:1,x:0,y:0},edit:{z:1,x:0,y:0}};let pan=false,panDrag=null;
  const camera=()=>cameras[api.state().view]||cameras.live;
  function paintCamera(){const c=camera();const cv=api.state().view==='edit'?$('editCv'):$('pad');cv.style.transform=`translate(${c.x}px,${c.y}px) scale(${c.z})`;zoomButton.querySelector('span').textContent=Math.round(c.z*100)+'%';zoomButton.disabled=api.state().view==='grid';cv.style.cursor=pan?'grab':'';}
  const zoomActions=make('div','wb-actions');pages.view.append(make('p','wb-note','表示だけを拡大します。書き出す形や寸法は変わりません。'),zoomActions);
  [1,1.5,2,3].forEach(z=>zoomActions.append(button(z*100+'%',()=>{camera().z=z;paintCamera();close();})));
  pages.view.append(button('画面に収める',()=>{Object.assign(camera(),{z:1,x:0,y:0});pan=false;paintCamera();close();}),button('指で表示を移動',()=>{pan=true;paintCamera();close();message('ドラッグで表示を移動。下の道具を選ぶと編集に戻ります');}));
  ['pad','editCv'].forEach(id=>{const cv=$(id);
    cv.addEventListener('pointerdown',e=>{if(!pan)return;e.preventDefault();e.stopImmediatePropagation();const c=camera();panDrag={id:e.pointerId,x:e.clientX,y:e.clientY,ox:c.x,oy:c.y};cv.setPointerCapture(e.pointerId);},true);
    cv.addEventListener('pointermove',e=>{if(!pan)return;e.preventDefault();e.stopImmediatePropagation();if(!panDrag||e.pointerId!==panDrag.id)return;const c=camera();c.x=panDrag.ox+e.clientX-panDrag.x;c.y=panDrag.oy+e.clientY-panDrag.y;paintCamera();},true);
    ['pointerup','pointercancel','lostpointercapture'].forEach(type=>cv.addEventListener(type,e=>{if(!pan)return;e.stopImmediatePropagation();panDrag=null;},true));
  });
  dock.addEventListener('click',()=>{pan=false;paintCamera();});
  const guide=move('snapBtn',context);guide.title='吸着を切り替える';
  const quick=make('div','');quick.id='wbQuick';context.append(quick);
  const styleButton=button('線幅 3',()=>open('style'));styleButton.id='wbStyle';quick.append(styleButton);
  const colorButton=button('色',()=>open('style'));colorButton.id='wbColor';colorButton.prepend(make('i','wb-ink'));quick.append(colorButton);
  const settingsButton=button('設定',()=>open('symmetry'));quick.append(settingsButton);
  const moreSel=button('編集',()=>open('selection'));moreSel.id='wbSelection';quick.append(moreSel);
  const formControls=make('div','');formControls.id='wbForm';context.append(formControls);
  const join=button('つなぐ',()=>{api.formErase(false);sync();});const cut=button('けずる',()=>{api.formErase(true);sync();});formControls.append(join,cut,button('設定',()=>open('symmetry')));
  const anchorControls=make('div','');anchorControls.id='wbAnchor';context.append(anchorControls);
  const smooth=button('角・曲線',()=>{api.smoothAnchor();sync();});const delPoint=button('点を削除',()=>{api.deleteAnchor();sync();});anchorControls.append(smooth,delPoint,button('設定',()=>open('symmetry')));
  move('penbar',context);
  [['tMove','選択','cursor'],['tAnchor','点','edit'],['tFree','描く','pencil'],['tForm','形成','apps-square']].forEach(([id,l,i])=>{move(id,dock);relabel(id,l,i);});
  const more=button('道具',()=>open('tools'),'more-horizontal');dock.append(more);
  ['tPen','tLine','tRect','tEllipse','tPoly','tErase'].forEach(id=>$(id).addEventListener('click',()=>{close();if(api.state().view==='edit')api.view('live');sync();}));
  $('tFree').onclick=()=>{api.tool('freehand');sync();};
  // ペン確定はコンテキスト行へ常設。描画中に別表示へ移って失わない。
  function changeView(v){if(api.state().pen){message('描きかけのペンを確定または取消してから表示を切り替えてください');return;}api.view(v);try{localStorage.setItem('symmetry-machine.workbench.view',v);}catch{}sync();resize();}
  $('modeLive').onclick=()=>changeView('live');$('modeEdit').onclick=()=>changeView('edit');$('modeGrid').onclick=()=>changeView('grid');
  const notice=make('div','',`<span></span><button type="button" aria-label="通知を閉じる">${icon('close')}</button>`);notice.id='wbMessage';notice.hidden=true;document.body.append(notice);notice.querySelector('button').onclick=()=>notice.hidden=true;
  function message(text){if(dialog.open){$('wbFeedback').textContent=text;$('wbFeedback').hidden=false;notice.hidden=true;return;}notice.querySelector('span').textContent=text;notice.hidden=false;clearTimeout(messageTimer);if(!/できません|失敗|不可|容量|読み取れ|確認してください/.test(text))messageTimer=setTimeout(()=>notice.hidden=true,6500);}
  const hint=$('stateHint');hint.hidden=true;document.body.append(hint);
  new MutationObserver(()=>{if(!hint.textContent){lastHint='';return;}if(hint.textContent!==lastHint){lastHint=hint.textContent;message(lastHint);}}).observe(hint,{childList:true,subtree:true,characterData:true});let lastHint='';
  // 旧フレームは参照されるIDを保ったまま非表示にする。
  oldbar.hidden=true;$('panel').hidden=true;
  const pinButton=button('案を残す',pin,'pin');pinButton.id='wbPin';
  status.append(pinButton);
  let pinRecords=[];const PIN_KEY='symmetry-machine.workbench.pins.v1';
  try{const data=JSON.parse(localStorage.getItem(PIN_KEY)||'[]');if(Array.isArray(data))pinRecords=data.filter(p=>p&&typeof p.name==='string'&&p.snapshot&&typeof p.image==='string'&&p.image.startsWith('data:image/png;')).slice(0,24);}catch{message('保存した案の一覧を読み取れません。JSONのバックアップを確認してください');}
  function pin(){
    if(api.state().empty){message('線や図形を描いてから案を残してください');return;}
    if(pinRecords.length>=24){message('案は24件まで保存できます。不要な案を一覧から外してから残してください');return;}
    try{const state=api.state(),rec={name:`案 ${String(pinRecords.length+1).padStart(2,'0')} · ${state.name}`,image:api.preview(),snapshot:api.snapshot()};const next=[...pinRecords,rec];localStorage.setItem(PIN_KEY,JSON.stringify(next));pinRecords=next;message(`${rec.name} を残しました。作品メニューの「残した案を比べる」から戻れます`);sync();}
    catch{message('案を保存できませんでした。容量を確認するか、作品メニューからJSONで保存してください');}
  }
  let beforeRecall=null;
  function renderPins(){
    pages.pins.replaceChildren();pages.pins.append(make('p','wb-note','残した時点の形を保ちます。選んだ案から続きを作れます。'));
    if(beforeRecall)pages.pins.append(button('案を開く前の状態に戻す',()=>{api.restore(beforeRecall);beforeRecall=null;close();sync();resize();}));
    if(!pinRecords.length){pages.pins.append(make('p','wb-note','まだ案がありません。作業画面の「案を残す」で記録できます。'));return;}
    const grid=make('div','wb-pins');pages.pins.append(grid);
    pinRecords.forEach((p,i)=>{const cell=make('article','wb-pin');const img=document.createElement('img');img.src=p.image;img.alt=p.name;const label=document.createElement('p');label.textContent=p.name;cell.append(img,label);
      cell.append(button('この案から作る',()=>{try{beforeRecall=api.snapshot();api.restore(p.snapshot);api.view('edit');close();sync();resize();message('案を開きました。開く前の状態は比較画面から戻せます');}catch(e){message(e.message);}}));
      cell.append(button('一覧から外す',()=>{try{const next=pinRecords.filter((_,n)=>n!==i);localStorage.setItem(PIN_KEY,JSON.stringify(next));pinRecords=next;renderPins();}catch{message('一覧を保存できませんでした');}}));grid.append(cell);});
  }
  let family='rosette';
  function renderRules(){
    pages.rules.replaceChildren();const tabs=make('div','wb-tabs');pages.rules.append(tabs);
    [['rosette','シンボル'],['frieze','帯'],['wallpaper','面'],['custom','独自']].forEach(([k,label])=>{const b=button(label,()=>{family=k;renderRules();});b.setAttribute('aria-pressed',String(family===k));tabs.append(b);});
    const grid=make('div','wb-rule-grid');pages.rules.append(grid);
    api.specs().filter(s=>s.spec.kind===family).forEach(({spec})=>{const name=spec.def?spec.def.name:spec.name;const b=button(name,()=>{api.choose(spec);close();sync();resize();});b.setAttribute('aria-pressed',String(name===api.state().name));grid.append(b);});
    pages.rules.append(button('対称の設定',()=>open('symmetry')));
    pages.rules.append(button('形を一覧で選ぶ',()=>{close();changeView('grid');}));
  }
  function setupSwatches(){api.specs().forEach(({wrap,spec})=>{wrap.setAttribute('role','option');wrap.setAttribute('aria-label',spec.def?spec.def.name:spec.name);wrap.setAttribute('aria-selected',String(wrap.classList.contains('sel')));wrap.tabIndex=wrap.classList.contains('sel')?0:-1;
    if(wrap.dataset.wbBound)return;wrap.dataset.wbBound='1';wrap.addEventListener('keydown',e=>{const list=api.specs(),i=list.findIndex(s=>s.wrap===wrap);if(['Enter',' '].includes(e.key)){e.preventDefault();api.choose(spec);changeView('edit');}else if(['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const n=Math.max(0,Math.min(list.length-1,i+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)));api.choose(list[n].spec);list[n].wrap.focus();}sync();});
    wrap.addEventListener('click',sync);
  });}
  $('results').setAttribute('role','listbox');$('results').setAttribute('aria-label','対称ルールの候補');
  function sync(){
    const s=api.state();ruleButton.querySelector('span').textContent=s.name;
    $('wbTarget').textContent=s.view==='grid'?`編集中：${s.name}`:`${s.view==='edit'?s.name+' の展開':'原画'} · ${s.selected?s.selected+'個を選択':s.tool==='freehand'?'線を描く':s.tool==='anchor'?'点を編集':s.tool==='form'?'形成':s.tool==='axis'?'中心を指定':'制作中'}`;
    $('wbSaved').textContent=Store.persistState==='ok'?'自動保存':Store.persistState==='degraded'?'画像は未保存':'保存不可';
    const sw=s.style.sw;styleButton.querySelector('span').textContent=`線幅 ${sw===undefined?'混在':sw}`;
    styleButton.title=s.selected?'選択したものの線幅と色':'次に描くものの線幅と色';
    colorButton.style.setProperty('--wb-ink',$('inkColor').value);
    $('wbQuick').hidden=s.pen>0||s.tool==='form'||s.tool==='anchor';
    formControls.hidden=s.tool!=='form'||s.pen>0;join.setAttribute('aria-pressed',String(!s.formErase));cut.setAttribute('aria-pressed',String(s.formErase));join.classList.toggle('on',!s.formErase);cut.classList.toggle('on',s.formErase);
    anchorControls.hidden=s.tool!=='anchor'||s.pen>0;smooth.disabled=delPoint.disabled=!s.anchor;
    moreSel.hidden=!s.selected;settingsButton.hidden=!!s.selected;pinButton.disabled=s.empty;
    guide.hidden=s.pen>0;pinButton.title=`${pinRecords.length}案を保存済み`;
    document.querySelectorAll('#wbDock button').forEach(b=>b.setAttribute('aria-pressed',String(b.classList.contains('on'))));
    $('modeLive').setAttribute('aria-pressed',String(s.view==='live'));$('modeEdit').setAttribute('aria-pressed',String(s.view==='edit'));$('modeGrid').setAttribute('aria-pressed',String(s.view==='grid'));
    setupSwatches();paintCamera();
  }
  function queueSync(){cancelAnimationFrame(syncFrame);syncFrame=requestAnimationFrame(sync);}
  document.addEventListener('click',queueSync);document.addEventListener('input',queueSync);document.addEventListener('pointerup',queueSync);document.addEventListener('keydown',queueSync);document.addEventListener('symmetry:change',queueSync);Store.onChange(queueSync);Store.onPersist(queueSync);
  function resize(){cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{const host=$('padCol'),size=Math.max(80,Math.min(host.clientWidth-32,art.clientHeight-32,880));document.documentElement.style.setProperty('--wb-pad',size+'px');api.resize();sync();});}
  new ResizeObserver(resize).observe(art);window.addEventListener('resize',resize);
  if(window.visualViewport)window.visualViewport.addEventListener('resize',()=>{document.documentElement.style.setProperty('--wb-view-height',window.visualViewport.height+'px');resize();});
  const initial=api.specs().find(s=>s.wrap.classList.contains('sel'))||api.specs().find(s=>s.spec.def&&s.spec.def.name==='C6')||api.specs()[0];
  api.choose(initial.spec);let initialView='live';try{const v=localStorage.getItem('symmetry-machine.workbench.view');if(['live','edit','grid'].includes(v))initialView=v;}catch{}
  // 初回の狭い画面（スマホ）: 原画では展開が見えないので、最初の線が6回展開された模様を先に見せる（INIT-01）。画面幅は workbench.css の #live 表示条件（1000px）に合わせる
  if(api.firstRun&&innerWidth<1000){let saved=null;try{saved=localStorage.getItem('symmetry-machine.workbench.view');}catch{}if(!saved)initialView='edit';}
  api.view(initialView);sync();resize();
})();
