/** Function-based Weather module. Dependencies are injected from the application context. */
export function createWeatherModule(deps) {
  const { C, CONFIG, dLong, dShort, esc, fmt, num, toast, today } = deps;
  let W = null, Wfail = false;
function wxKind(c) {
  if (c === 0) return 'clear'; if (c === 1 || c === 2) return 'partly'; if (c === 3) return 'cloud';
  if (c === 45 || c === 48) return 'fog'; if (c >= 51 && c <= 57) return 'drizzle';
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain'; if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 95) return 'storm'; return 'cloud';
}
const WX_LABEL = { clear: 'Clear sky', partly: 'Partly cloudy', cloud: 'Overcast', fog: 'Foggy', drizzle: 'Drizzle', rain: 'Rain', snow: 'Snow', storm: 'Thunderstorm' };
function wxScene(kind, day, wind, temp, label) {
  let h = '';
  const stars = [[8,12],[22,40],[35,18],[48,52],[60,10],[72,34],[84,16],[92,48],[14,70],[66,66]].map(([l, t], i) => `<i style="left:${l}%;top:${t}px;animation-delay:${i * .4}s"></i>`).join('');
  if (!day && (kind === 'clear' || kind === 'partly' || kind === 'cloud')) h += `<div class="stars">${stars}</div>`;
  if (kind === 'clear' || kind === 'partly') h += day ? '<div class="sun"><i></i></div>' : '<div class="moon"></div>';
  const nc = { clear: 0, partly: 2, cloud: 3, fog: 0, drizzle: 3, rain: 3, storm: 3, snow: 3 }[kind];
  for (let i = 0; i < nc; i++) h += `<div class="cl" style="top:${22 + i * 20}px;left:${8 + i * 28}%;--d:${16 + i * 5}s;transform:scale(${1 - i * .12})"></div>`;
  const nd = { drizzle: 14, rain: 34, storm: 46 }[kind] || 0;
  for (let i = 0; i < nd; i++) h += `<div class="drop" style="left:${(i * 37 + 5) % 100}%;animation-delay:${(i * 0.17) % 0.9}s;animation-duration:${(0.55 + (i % 4) * .08)}s"></div>`;
  if (kind === 'snow') for (let i = 0; i < 26; i++) h += `<div class="flake" style="left:${(i * 41 + 7) % 100}%;animation-delay:${(i * .31) % 4}s;animation-duration:${3 + (i % 4)}s"></div>`;
  if (kind === 'storm') h += '<svg class="bolt" viewBox="0 0 34 70"><polygon points="20,0 2,40 15,40 8,70 32,26 18,26" fill="#FFE27A"/></svg>';
  if (kind === 'fog') for (let i = 0; i < 4; i++) h += `<div class="fogbar" style="top:${30 + i * 28}px;animation-delay:${i * 1.3}s"></div>`;
  if (wind >= 18) for (let i = 0; i < 4; i++) h += `<div class="wl" style="top:${24 + i * 30}px;animation-delay:${i * .6}s;animation-duration:${2.4 - Math.min(1.2, wind / 40)}s"></div>`;
  return `<div class="wx-scene ${day ? 'day' : 'night'} k-${kind}">${h}<div class="wx-over"><div class="t">${temp}</div><div class="c">${esc(label)}</div></div></div>`;
}
function wxIcon(kind, day) {
  const cloud = (fill = '#C5CED8') => `<g class="ico-drift"><path d="M9 24h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 9.2 15.2 4.4 4.4 0 0 0 9 24z" fill="${fill}"/></g>`;
  const sun = '<circle cx="16" cy="16" r="5.5" fill="#F7B500"/><g class="ico-rot" stroke="#F7B500" stroke-width="2" stroke-linecap="round"><path d="M16 3v3M16 26v3M3 16h3M26 16h3M6.8 6.8l2.1 2.1M23.1 23.1l2.1 2.1M6.8 25.2l2.1-2.1M23.1 8.9l2.1-2.1"/></g>';
  const moon = '<path d="M21 6a10 10 0 1 0 5 17 8.5 8.5 0 0 1-5-17z" fill="#EFE8BE"/>';
  let b = '';
  if (kind === 'clear') b = day ? sun : moon;
  else if (kind === 'partly') b = (day ? '<circle cx="12" cy="11" r="4.5" fill="#F7B500"/>' : '<path d="M14 4a7 7 0 1 0 4 12 6 6 0 0 1-4-12z" fill="#EFE8BE"/>') + cloud();
  else if (kind === 'fog') b = '<g stroke="#AEB9C5" stroke-width="2.4" stroke-linecap="round"><path class="ico-drift" d="M6 11h20M4 17h22M8 23h18"/></g>';
  else if (kind === 'snow') b = cloud() + '<g fill="#fff" stroke="#9db0c4" stroke-width=".6"><circle class="ico-drop" cx="11" cy="27" r="1.6"/><circle class="ico-drop" style="animation-delay:.4s" cx="17" cy="27" r="1.6"/><circle class="ico-drop" style="animation-delay:.7s" cx="23" cy="27" r="1.6"/></g>';
  else if (kind === 'drizzle' || kind === 'rain') b = cloud('#9AA7B6') + `<g stroke="#4A90D9" stroke-width="2" stroke-linecap="round"><path class="ico-drop" d="M11 26v2"/><path class="ico-drop" style="animation-delay:.35s" d="M16 26v2"/><path class="ico-drop" style="animation-delay:.7s" d="M21 26v2"/></g>`;
  else if (kind === 'storm') b = cloud('#6D7488') + '<polygon class="ico-flash" points="17,18 11,27 16,27 14,32 22,22 17,22" fill="#F7C531"/>';
  else b = cloud();
  return `<svg class="ico" viewBox="0 0 32 32" aria-hidden="true">${b}</svg>`;
}
function advisory(w) {
  const k = wxKind(w.code);
  if (k === 'storm') return { t: 'bad', m: 'Thunderstorm — pull machines and staff off the course', i: 'thunderstorm' };
  if (k === 'rain' || k === 'drizzle' || w.precip > 0.4) return { t: 'warn', m: 'Rain — hold mowing and spraying', i: 'umbrella' };
  if (w.wind >= CONFIG.WIND_LIMIT) return { t: 'warn', m: `Wind ${Math.round(w.wind)} km/h — avoid spraying`, i: 'air' };
  if (w.temp >= 36) return { t: 'warn', m: 'High heat — schedule operators early morning', i: 'device_thermostat' };
  return { t: 'ok', m: 'Conditions suitable for normal operations', i: 'check_circle' };
}
let wxSig = '', wxForecastNotificationSignature = '';
const WX_RAIN_NOTIFIED_KEY = 'clover-greens-rain-notified-date-v1';
let wxLastNotifiedDateMemory = '';
function updateRainNotificationButton(){
  const b=$('#wxEnableNotify'); if(!b)return;
  const granted=typeof Notification!=='undefined'&&Notification.permission==='granted';
  b.classList.toggle('enabled',granted);
  b.innerHTML=`<span class="material-symbols-rounded">${granted?'notifications_active':'notifications'}</span><span>${granted?'Rain alerts enabled':'Enable rain alerts'}</span>`;
  b.title=granted?'Rain alerts can appear while this dashboard is open.':'Allow browser notifications for rain signals in the next seven days.';
}
function maybeNotifyRainForecast(){
  if(typeof Notification==='undefined'||Notification.permission!=='granted'||!W?.forecast)return;
  const risk=wxRainDays().sort((a,b)=>a.index-b.index)[0]; if(!risk)return;
  let last=''; try{last=localStorage.getItem(WX_RAIN_NOTIFIED_KEY)||'';}catch(_){/* storage may be blocked */}
  if(last===risk.date||wxLastNotifiedDateMemory===risk.date)return;
  const chance=Number.isFinite(risk.probability)?`${Math.round(risk.probability)}% chance of rain`:'rain is forecast';
  const body=`${wxDayLabel(risk.date,risk.index)} (${dLong(risk.date)}): ${chance}, ${fmt(risk.precipitation,1)} mm expected. Check spraying and mowing plans.`;
  try{
    new Notification('Clover Greens · rain outlook',{body,tag:`clover-greens-rain-${risk.date}`,renotify:false});
    wxLastNotifiedDateMemory=risk.date;
    try{localStorage.setItem(WX_RAIN_NOTIFIED_KEY,risk.date);}catch(_){/* session notification still delivered */}
  }catch(e){console.warn('Could not display rain notification:',e);}
}
async function enableRainNotifications(){
  if(typeof Notification==='undefined'){toast('This browser does not support system notifications. The on-page rain alert remains available.','warn');return;}
  if(!window.isSecureContext){toast('Browser rain notifications require the dashboard to be served over HTTPS. The on-page rain alert remains available.','warn');return;}
  try{
    const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
    updateRainNotificationButton();
    if(permission!=='granted'){toast('Rain notifications were not enabled. The seven-day alert line will still update.','warn');return;}
    toast('Rain notifications enabled while this dashboard is open.','ok');
    maybeNotifyRainForecast();
  }catch(e){toast('Could not enable rain notifications: '+(e.message||'permission unavailable'),'err');}
}
function wxDayLabel(date, idx) {
  if (idx===0) return 'Today'; if (idx===1) return 'Tomorrow';
  return new Date(date+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short'});
}
function wxRainDays() {
  const days=W && W.forecast && Array.isArray(W.forecast.days)?W.forecast.days:[];
  return days.map((d,i)=>({...d,index:i})).filter(d=>(Number.isFinite(d.probability)&&d.probability>=45)||num(d.precipitation)>=1||['rain','drizzle','storm'].includes(wxKind(d.code)));
}
function renderRainNotice() {
  const btn=$('#wxRainNotice'); if(!btn)return;
  if(!W || !W.forecast){btn.className='wx-rain-notice calm';btn.innerHTML=`<span class="material-symbols-rounded">${Wfail?'cloud_off':'cloud_sync'}</span><span class="wx-rain-label">${Wfail?'Rain forecast unavailable':'Checking rain forecast…'}</span>`;return;}
  const risk=wxRainDays().sort((a,b)=>a.index-b.index)[0];
  if(risk){
    const chance=Number.isFinite(risk.probability)?`${Math.round(risk.probability)}%`:`${fmt(risk.precipitation,1)} mm`;
    btn.className='wx-rain-notice rain-risk';btn.title=`Rain signal ${risk.date}: probability ${Number.isFinite(risk.probability)?Math.round(risk.probability)+'%':'not available'}, expected precipitation ${fmt(risk.precipitation,1)} mm. Forecast model, not a rain gauge.`;
    btn.innerHTML=`<span class="material-symbols-rounded">notifications_active</span><span class="wx-rain-label">Rain · ${esc(wxDayLabel(risk.date,risk.index))} · ${esc(chance)}</span>`;
  } else {
    btn.className='wx-rain-notice calm';btn.title='No significant rainfall signal in the current seven-day forecast.';
    btn.innerHTML='<span class="material-symbols-rounded">notifications_none</span><span class="wx-rain-label">Low rain signal · 7 days</span>';
  }
}
function renderWeather() {
  renderRainNotice(); updateRainNotificationButton();
  const widget=$('#wxWidget');
  if (!W) {
    $('#wxChip').innerHTML = `<span class="wx-text">${Wfail?'Weather unavailable':'Syncing weather…'}</span>`;
    if(widget) widget.innerHTML=`<div class="wx-loading">${Wfail?'Weather service could not be reached. No conditions are fabricated.':'Fetching the course weather model…'}</div>`;
    const strip=$('#wxForecastStrip'); if(strip)strip.innerHTML=`<div class="wx-loading">${Wfail?'Seven-day rain forecast unavailable.':'Forecast loading…'}</div>`;
    const alert=$('#wxForecastAlert'); if(alert){alert.className='wx-forecast-alert clear';alert.innerHTML='<span class="material-symbols-rounded">cloud_off</span><span>Rain alerts are unavailable until a fresh forecast loads.</span>';}
    return;
  }
  const forecastDays=W.forecast?.days||[];
  const stamp=$('#wxSourceStamp');
  if(stamp){const fetched=W.forecast?.fetchedAt;const when=fetched?new Date(fetched).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'time unknown';stamp.textContent=W.forecast?.stale?`Forecast stale · last successful update ${when}`:`Open-Meteo model · updated ${when}`;}
  const sig=JSON.stringify([W.temp,W.hum,W.wind,W.code,W.day,W.precip,forecastDays.map(d=>[d.date,d.code,d.probability,d.precipitation])]);
  const kind=wxKind(W.code), label=WX_LABEL[kind], a=advisory(W);
  $('#wxChip').innerHTML=`${wxIcon(kind,W.day)}<span class="vdiv"></span><span class="wx-text">${Math.round(W.temp)}°C · ${esc(label)}</span><span class="wx-text wx-hum">${Math.round(W.hum)}% RH</span><span class="wx-text wx-wind">${Math.round(W.wind)} km/h</span>`;
  if(sig!==wxSig){
    wxSig=sig;
    if(widget) widget.innerHTML=wxScene(kind,W.day,W.wind,Math.round(W.temp)+'°C',label)+
      `<div class="wx-stats"><div><div class="k">Humidity</div><div class="v">${Math.round(W.hum)}%</div></div><div><div class="k">Wind</div><div class="v">${Math.round(W.wind)} km/h</div></div><div><div class="k">Precip now</div><div class="v">${fmt(W.precip,1)} mm</div></div></div>`+
      `<div class="advice ${a.t}"><span class="material-symbols-rounded">${a.i}</span>${esc(a.m)}</div>`;
    const strip=$('#wxForecastStrip');
    if(strip) strip.innerHTML=forecastDays.length?forecastDays.slice(0,7).map((d,i)=>{
      const k=wxKind(d.code), prob=Number.isFinite(d.probability)?Math.round(d.probability):null, rain=num(d.precipitation), risk=(prob!==null&&prob>=45)||rain>=1||['rain','drizzle','storm'].includes(k);
      return `<article class="wx-day ${risk?'rain':''} ${i===0?'today':''}"><div class="wx-day-name">${esc(wxDayLabel(d.date,i))}</div><div class="wx-day-date">${esc(dShort(d.date))}</div>${wxIcon(k,true)}<div class="wx-day-temps">${Math.round(num(d.high))}° / ${Math.round(num(d.low))}°</div><div class="wx-day-rain"><span class="material-symbols-rounded">water_drop</span>${prob===null?'—':prob+'%'}</div><div class="wx-day-mm">${fmt(rain,1)} mm</div><div class="wx-rain-meter"><i style="width:${prob===null?0:Math.max(0,Math.min(100,prob))}%"></i></div></article>`;
    }).join(''):'<div class="wx-loading">No daily forecast was returned.</div>';
    const nearest=wxRainDays().sort((x,y)=>x.index-y.index)[0], alert=$('#wxForecastAlert');
    if(alert){
      if(nearest){const riskText=Number.isFinite(nearest.probability)?`${Math.round(nearest.probability)}% rain chance`:'rain is forecast';alert.className='wx-forecast-alert';alert.innerHTML=`<span class="material-symbols-rounded">notifications_active</span><span><b>Rain signal · ${esc(wxDayLabel(nearest.date,nearest.index))}, ${esc(dLong(nearest.date))}</b><br>${riskText}; expected precipitation ${fmt(nearest.precipitation,1)} mm. Consider rescheduling spraying and checking ground conditions before mowing.</span>`;}
      else {alert.className='wx-forecast-alert clear';alert.innerHTML='<span class="material-symbols-rounded">notifications_none</span><span>No significant rain signal in this seven-day model forecast. Check again before time-sensitive spraying or course work.</span>';}
    }
  }
  // Keep the notice current even if the current conditions stay the same.
  renderRainNotice();
  const nearest=wxRainDays().sort((a,b)=>a.index-b.index)[0];
  const notifySig=nearest?nearest.date:'none';
  if(nearest && wxForecastNotificationSignature && notifySig!==wxForecastNotificationSignature){
    toast(`Updated rain forecast: ${wxDayLabel(nearest.date,nearest.index)} · ${Number.isFinite(nearest.probability)?Math.round(nearest.probability)+'% chance':fmt(nearest.precipitation,1)+' mm forecast'}`,'warn');
  }
  wxForecastNotificationSignature=notifySig;
  maybeNotifyRainForecast();
}
async function loadWeather() {
  try {
    const endpoint=String(CONFIG.WEATHER_PROXY_URL||'').trim() || 'https://api.open-meteo.com/v1/forecast';
    const q=`latitude=${CONFIG.LAT}&longitude=${CONFIG.LNG}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,is_day,precipitation&hourly=precipitation_probability,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max&forecast_days=7&wind_speed_unit=kmh&timezone=auto`;
    const url=`${endpoint}${endpoint.includes('?')?'&':'?'}${q}`;
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),12000);
    let r; try { r=await fetch(url,{cache:'no-store',signal:controller.signal}); } finally { clearTimeout(timeout); }
    if(!r.ok)throw new Error(`weather ${r.status}`);
    const data=await r.json(); if(!data.current || !data.daily)throw new Error('incomplete forecast payload');
    const c=data.current, d=data.daily;
    const days=(d.time||[]).slice(0,7).map((date,i)=>({date,code:num(d.weather_code?.[i]),high:num(d.temperature_2m_max?.[i]),low:num(d.temperature_2m_min?.[i]),prob:Number.isFinite(d.precipitation_probability_max?.[i])?d.precipitation_probability_max[i]:null,precipitation:num(d.precipitation_sum?.[i]),windMax:num(d.wind_speed_10m_max?.[i])}));
    W={temp:c.temperature_2m,hum:c.relative_humidity_2m,wind:c.wind_speed_10m,code:c.weather_code,day:c.is_day===1,precip:c.precipitation||0,forecast:{days,timezone:data.timezone||'auto',fetchedAt:Date.now(),stale:false}}; Wfail=false;
  } catch(e) {
    console.warn('Course weather forecast unavailable:',e);
    Wfail=true;
    if(W?.forecast) W.forecast.stale=true;
  }
  renderWeather();
}


  return { renderWeather, loadWeather, enableRainNotifications };
}
