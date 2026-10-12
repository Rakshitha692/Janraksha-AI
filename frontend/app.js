let me=null, cases=[], policeRefreshTimer=null, phonePushSetup=null; const $=s=>document.querySelector(s);
const api=async(url,opts={})=>{let r=await fetch(url,opts),d=await r.json().catch(()=>({}));if(!r.ok){const staleWebcamApi=/\/api\/ai\/webcam\/references/.test(url)&&[404,405].includes(r.status);throw Error(staleWebcamApi?'The running server does not have the webcam registration API yet. Stop it and restart JanRaksha from this workspace, then refresh.':d.error||`Request failed (HTTP ${r.status}). Check that the server is running the latest app code.`)}return d};
const toast=m=>{let t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3200)};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
function decodeVapidKey(value){const padding='='.repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(base64);return Uint8Array.from(raw,char=>char.charCodeAt(0))}
async function preparePhonePush(){if(!window.isSecureContext||!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw Error('Phone push needs a supported browser and a secure HTTPS site.');const [config,registration]=await Promise.all([api('/api/push/public-key'),navigator.serviceWorker.register('/service-worker.js')]);return{config,registration}}
async function enablePhoneNotifications(button){const status=$('#phoneNotificationStatus');button.disabled=true;try{if(/iphone|ipad|ipod/i.test(navigator.userAgent)&&!navigator.standalone&&!matchMedia('(display-mode: standalone)').matches)throw Error('On iPhone, add JanRaksha to the Home Screen from Safari, open it there, then enable notifications.');if(Notification.permission==='denied')throw Error('Notifications are blocked for this site. Allow them in your browser or phone settings.');if(Notification.permission!=='granted'&&await Notification.requestPermission()!=='granted')throw Error('Notification permission was not granted.');const {config,registration}=await phonePushSetup;let subscription=await registration.pushManager.getSubscription();if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeVapidKey(config.public_key)});await api('/api/push/subscription',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(subscription.toJSON())});button.textContent='Phone notifications enabled';status.textContent='This phone or browser can receive JanRaksha alerts.';toast('Phone notifications enabled on this device.')}catch(error){status.textContent=error.message;toast(error.message)}finally{button.disabled=false}}
function showAuth(which){$('#authView').classList.remove('d-none');$('#loginModal').classList.toggle('d-none',which!=='login');$('#registerModal').classList.toggle('d-none',which!=='register')};function hideAuth(){$('#loginModal').classList.add('d-none');$('#registerModal').classList.add('d-none')}
$('#loginForm').onsubmit=async e=>{e.preventDefault();try{let f=new FormData(e.target);await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(f))});boot()}catch(x){toast(x.message)}};
$('#registerForm').onsubmit=async e=>{e.preventDefault();try{let f=new FormData(e.target),d=Object.fromEntries(f);d.terms=f.get('terms')==='on';await api('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});boot()}catch(x){toast(x.message)}};
async function boot(){try{me=(await api('/api/users/me')).user}catch{if(window.location.pathname==='/police'){me=null;$('#authView').classList.add('d-none');$('#appView').classList.remove('d-none');$('aside').classList.add('d-none');$('.workspace').style.marginLeft='0';$('#userName').textContent='';$('#roleBadge').textContent='POLICE PORTAL';policePortal($('#page'))}return}$('#authView').classList.add('d-none');hideAuth();$('#appView').classList.remove('d-none');$('#userName').textContent=me.name;$('#roleBadge').textContent=me.role.replace('_',' ');if(window.location.pathname==='/police'){if(['POLICE_OFFICER','ADMIN_DEMO'].includes(me.role)){showPolicePortalShell();return policePortal($('#page'))}$('aside').classList.add('d-none');$('.workspace').style.marginLeft='0';me=null;return policePortal($('#page'))}const matchMatch = window.location.pathname.match(/\/investigator\/matches\/(\d+)/);if(matchMatch && ['INVESTIGATOR','ADMIN_DEMO','FAMILY_USER','CITIZEN'].includes(me.role)){return openInvestigatorMatch(Number(matchMatch[1]));}go(new URLSearchParams(location.search).get('page')==='emergency'?'emergency':'dashboard')}
document.querySelectorAll('.nav-link[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));$('.logout').onclick=async()=>{await api(location.pathname==='/police'?'/api/police/logout':'/api/auth/logout',{method:'POST'});location.reload()};
const heading=(t,s='')=>`<h1 class="page-title">${t}</h1><p class="page-subtitle">${s}</p>`;
async function go(page){clearInterval(policeRefreshTimer);policeRefreshTimer=null;const activePage=['emergency','emergency-center'].includes(page)?'emergency-community':page;document.querySelectorAll('.nav-link').forEach(x=>x.classList.toggle('active',x.dataset.page===activePage));let el=$('#page');el.innerHTML='<div class="empty">Loading…</div>';try{if(page==='dashboard'){if(location.pathname==='/police'&&me&&['POLICE_OFFICER','ADMIN_DEMO'].includes(me.role)){policeDashboard(el);return}await dashboard(el);return}if(page==='cases'){await gallery(el);return}if(page==='register-case'){await caseForm(el);return}if(page==='search'){await search(el);return}if(page==='webcam'){await webcamSearch(el);return}if(page==='sighting'){await sightingForm(el);return}if(page==='found'){await foundForm(el);return}if(page==='notifications'){await notifications(el);return}if(page==='emergency'){await emergency(el,true);return}if(page==='emergency-community'){await emergency(el);return}if(page==='emergency-center'){await emergency(el,true);return}if(page==='police-portal'){await policePortal(el);return}}catch(e){el.innerHTML=`<div class="alert alert-danger">${escapeHtml(e.message)}</div>`}}

const webcamState={stream:null,active:false,starting:false,sessionId:null,processing:false,intervalId:null,facingMode:'user'};

async function webcamSearch(el){
  if (!['FAMILY_USER','CITIZEN','INVESTIGATOR','ADMIN_DEMO','POLICE_OFFICER'].includes(me.role)) {
    el.innerHTML = heading('Live webcam crowd detection', 'Sign in as a family member, citizen, investigator, or administrator to use your camera.') + '<div class="alert alert-warning">Your account does not currently have permission to access webcam matching.</div>';
    return;
  }
  el.innerHTML = heading('Live webcam', 'Register webcam-only reference photos and compare camera faces against that separate registry.') + `
    <div class="alert-ai mb-3"><strong>Privacy:</strong> Webcam registrations and their photos are visible only to the account that registered them. They are used only by that account's live webcam and video scans.</div>
    <div class="panel webcam-registry-panel">
      <h3>Webcam-only registrations</h3>
      <p class="text-muted">Upload one clear, front-facing photo. Use a photo you are authorized to register.</p>
      <form id="webcamReferenceForm" class="webcam-reference-form">
        <label>Clear face photo<input name="photo" type="file" accept="image/png,image/jpeg" required></label>
        <button class="btn btn-outline-primary" type="submit">Register for webcam only</button>
      </form>
      <div id="webcamReferenceList" class="webcam-reference-list"><div class="empty">Loading webcam-only registrations…</div></div>
    </div>
    <div class="panel webcam-shell">
      <div class="webcam-controls">
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-primary" id="startCameraBtn">Start camera</button>
          <button class="btn btn-outline-secondary" id="stopCameraBtn">Stop camera</button>
          <button class="btn btn-outline-primary" id="captureFrameBtn">Capture frame</button>
          <button class="btn btn-outline-primary" id="switchCameraBtn">Switch camera</button>
        </div>
        <div class="webcam-source-tools mt-3">
          <form id="webcamVideoScanForm" class="webcam-source-form">
            <label>Upload a video
              <input name="video" type="file" accept="video/*" required>
            </label>
            <button class="btn btn-outline-primary" type="submit">Scan video</button>
            <small class="text-muted">Any video format supported by this server's OpenCV/FFmpeg installation.</small>
          </form>
          <form id="webcamUrlScanForm" class="webcam-source-form">
            <label>Video or stream URL
              <input name="stream_url" type="url" placeholder="https://example.com/video.mp4" required>
            </label>
            <button class="btn btn-outline-primary" type="submit">Scan video URL</button>
            <small class="text-muted">Use a direct video or stream link supported by this server's OpenCV/FFmpeg installation.</small>
          </form>
        </div>
      </div>
      <div class="webcam-stage mt-3">
        <video id="webcamVideo" autoplay playsinline muted></video>
        <div id="faceOverlay" class="face-overlay"></div>
      </div>
      <div class="webcam-summary mt-3">
        <div><strong>Camera status:</strong> <span id="cameraStatus">Inactive</span></div>
        <div><strong>Faces detected:</strong> <span id="facesDetected">0</span></div>
        <div><strong>Processing:</strong> <span id="processingStatus">Idle</span></div>
      </div>
      <div id="capturedFramePreview" class="captured-frame-preview d-none mt-3">
        <strong>Captured frame and per-face results</strong>
        <div class="captured-frame-layout">
          <div class="captured-frame-stage">
            <img alt="Captured webcam frame with face detection boxes" class="captured-frame-image">
            <div id="capturedFrameOverlay" class="face-overlay captured-face-overlay"></div>
          </div>
          <div id="capturedFrameMatch" class="captured-frame-match"></div>
        </div>
      </div>
      <div id="webcamResults" class="webcam-results mt-3"></div>
    </div>
  `;
  const video=$('#webcamVideo'); const overlay=$('#faceOverlay'); const statusEl=$('#cameraStatus'); const facesEl=$('#facesDetected'); const processEl=$('#processingStatus'); const resultsEl=$('#webcamResults'); const previewEl=$('#capturedFramePreview'); const previewImage=previewEl.querySelector('img'); const previewOverlay=$('#capturedFrameOverlay'); const capturedMatchEl=$('#capturedFrameMatch'); const faceElements=new Map();
  const referenceList=$('#webcamReferenceList');
  async function refreshWebcamReferences(){
    const data=await api('/api/ai/webcam/references');
    referenceList.innerHTML=data.items.map(person=>`<article class="webcam-reference-row"><img src="${escapeHtml(person.photo)}" alt="Your registered webcam reference"><div><strong>${escapeHtml(person.reference_id)}</strong></div>${person.can_delete?`<button type="button" class="btn btn-sm btn-outline-danger" data-remove-webcam-reference="${person.id}">Remove</button>`:''}</article>`).join('')||'<div class="empty">No webcam-only registrations yet. Add a clear photo before scanning.</div>';
  }
  void refreshWebcamReferences().catch(error=>{referenceList.innerHTML=`<div class="alert alert-danger">${escapeHtml(error.message)}</div>`});
  $('#webcamReferenceForm').onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget,button=form.querySelector('button[type="submit"]');
    button.disabled=true;button.textContent='Registering…';
    try{const response=await api('/api/ai/webcam/references',{method:'POST',body:new FormData(form)});form.reset();toast(response.message);await refreshWebcamReferences()}
    catch(error){toast(error.message)}
    finally{button.disabled=false;button.textContent='Register for webcam only'}
  };
  referenceList.addEventListener('click',async event=>{
    const button=event.target.closest('[data-remove-webcam-reference]');
    if(!button)return;
    button.disabled=true;
    try{const result=await api(`/api/ai/webcam/references/${button.dataset.removeWebcamReference}`,{method:'DELETE'});toast(result.message);await refreshWebcamReferences()}
    catch(error){toast(error.message);button.disabled=false}
  });
  let capturedFaces=[];
  function renderCapturedFaceBoxes(faces=[]){
    previewOverlay.replaceChildren();
    if (!previewImage.naturalWidth || !previewImage.naturalHeight) return;
    const overlayRect = previewOverlay.getBoundingClientRect();
    const scaleX = overlayRect.width / previewImage.naturalWidth;
    const scaleY = overlayRect.height / previewImage.naturalHeight;
    faces.forEach((face, index) => {
      const box = face.bbox || face;
      const faceBox = document.createElement('div');
      const matchScore = Number(face.similarity_score);
      const isMatch = face.status === 'POTENTIAL_MATCH' && Number.isFinite(matchScore) && matchScore >= 80;
      const statusClass = isMatch ? 'potential' : face.status === 'NO_RELEVANT_MATCH' ? 'no-match' : face.status === 'INSUFFICIENT_QUALITY' ? 'warning' : 'neutral';
      faceBox.className = `face-box ${statusClass}`;
      faceBox.style.left = `${box.x * scaleX}px`;
      faceBox.style.top = `${box.y * scaleY}px`;
      faceBox.style.width = `${box.width * scaleX}px`;
      faceBox.style.height = `${box.height * scaleY}px`;
      const label = document.createElement('div');
      label.className = 'face-label';
      const score = (face.ranked_matches || []).reduce((best, match) => Math.max(best, Number(match.similarity_score) || 0), 0);
      label.textContent = face.ranked_matches?.length ? `Face ${index + 1} · ${score.toFixed(1)}%` : `Face ${index + 1}`;
      faceBox.appendChild(label);
      previewOverlay.appendChild(faceBox);
    });
  }
  previewImage.addEventListener('load', () => renderCapturedFaceBoxes(capturedFaces));
  const startButton=$('#startCameraBtn'); const stopButton=$('#stopCameraBtn'); const captureButton=$('#captureFrameBtn'); const switchButton=$('#switchCameraBtn');
  async function submitVideoScan(form, useUrl=false){
    const submitButton=form.querySelector('button[type="submit"]');
    submitButton.disabled=true;
    submitButton.textContent='Scanning…';
    resultsEl.innerHTML='<div class="empty">Scanning sampled video frames for the highest similarity result…</div>';
    try {
      const response = useUrl
        ? await api('/api/ai/webcam/process-video', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({stream_url:form.elements.stream_url.value.trim()})})
        : await api('/api/ai/webcam/process-video', {method:'POST', body:new FormData(form)});
      if (response.best_match && String(response.best_match.case?.status || '').toUpperCase().replaceAll(' ', '_') === 'CLOSED') {
        response.best_match=null;
        response.message='Closed cases are excluded from video matching.';
      }
      const summary=document.createElement('div');
      summary.className='empty';
      summary.textContent=`Scanned ${response.frames_analyzed} video frame${response.frames_analyzed === 1 ? '' : 's'}.`;
      if (!response.best_match) {
        resultsEl.replaceChildren(summary, Object.assign(document.createElement('div'), {className:'empty', textContent:response.message}));
        return;
      }
      const result=document.createElement('div');
      result.className='result webcam-result webcam-result-potential';
      const note=document.createElement('p');
      note.className='webcam-review-note';
      note.textContent=`Highest similarity in the sampled frames at ${response.best_match.timestamp_seconds}s. Human verification is required; similarity is not proof of identity.`;
      result.appendChild(note);
      const matchContainer=document.createElement('div');
      matchContainer.innerHTML=renderWebcamReferenceMatch(response.best_match);
      result.appendChild(matchContainer);
      const verifyButton=matchContainer.querySelector('[data-webcam-verify]');
      if (verifyButton) verifyButton.addEventListener('click', async ()=>{
        verifyButton.disabled=true;
        try {
          let matchId=response.best_match.match_id;
          if (!matchId) {
            const review=await api(`/api/ai/webcam/session/${encodeURIComponent(response.session_id)}/review`, {
              method:'POST', headers:{'Content-Type':'application/json'},
              body:JSON.stringify({case_id:response.best_match.case.case_id, similarity_score:response.best_match.similarity_score})
            });
            matchId=review.match_id;
          }
          await openInvestigatorMatch(matchId);
        } catch (error) {
          toast(error.message || 'Could not open the verification form.');
          verifyButton.disabled=false;
        }
      });
      resultsEl.replaceChildren(summary, result);
    } catch (error) {
      resultsEl.innerHTML=`<div class="alert alert-danger">${escapeHtml(error.message || 'Video scan failed.')}</div>`;
    } finally {
      submitButton.disabled=false;
      submitButton.textContent=useUrl ? 'Scan video URL' : 'Scan video';
    }
  }
  $('#webcamVideoScanForm').addEventListener('submit', event=>{event.preventDefault(); void submitVideoScan(event.currentTarget);});
  $('#webcamUrlScanForm').addEventListener('submit', event=>{event.preventDefault(); void submitVideoScan(event.currentTarget, true);});
  function updateStatus(label){ statusEl.textContent = label; }
  function setProcessing(label){ processEl.textContent = label; }
  function syncWebcamControls(){
    startButton.disabled = webcamState.starting || webcamState.active;
    stopButton.disabled = webcamState.starting || !webcamState.active;
    captureButton.disabled = !webcamState.active || webcamState.processing;
    switchButton.disabled = webcamState.starting;
  }
  function renderFaceBoxes(faces=[]){
    const activeFaceIds = new Set();
    const videoRect = video.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const sourceWidth = video.videoWidth || 640;
    const sourceHeight = video.videoHeight || 420;
    const scale = Math.max(videoRect.width / sourceWidth, videoRect.height / sourceHeight);
    const offsetX = (videoRect.width - sourceWidth * scale) / 2;
    const offsetY = (videoRect.height - sourceHeight * scale) / 2;
    faces.forEach((result, index) => {
      const faceId = result.face_id || 'face_' + String(index + 1);
      activeFaceIds.add(faceId);
      const box = result.bbox || result;
      let faceBox = faceElements.get(faceId);
      if (!faceBox) {
        faceBox = document.createElement('div');
        faceElements.set(faceId, faceBox);
        overlay.appendChild(faceBox);
      }
      faceBox.replaceChildren();
      const x = videoRect.left - overlayRect.left + offsetX + box.x * scale;
      const y = videoRect.top - overlayRect.top + offsetY + box.y * scale;
      const w = box.width * scale, h = box.height * scale;
      // A ranked reference can be a low-confidence lead. Only the backend's
      // explicit potential-match decision is allowed to use green styling.
      const score = Number(result.similarity_score);
      // Backend status already reflects the SFace cosine threshold.
      const isMatch = result.status === 'POTENTIAL_MATCH' && Number.isFinite(score) && score >= 80;
      const statusClass = isMatch ? 'potential' : result.status === 'NO_RELEVANT_MATCH' ? 'no-match' : result.status === 'INSUFFICIENT_QUALITY' ? 'warning' : 'neutral';
      faceBox.className = `face-box ${statusClass}`;
      faceBox.style.left = x + 'px'; faceBox.style.top = y + 'px'; faceBox.style.width = w + 'px'; faceBox.style.height = h + 'px';
      const label = document.createElement('div');
      label.className = 'face-label';
      const faceLabel = faceId.startsWith('face_')
        ? 'Face ' + faceId.slice(5)
        : 'Face ' + String(index + 1).padStart(2, '0');
      const hasSimilarity = isMatch && Number.isFinite(score);
      const personName = result.matched_person?.name;
      label.textContent = hasSimilarity
        ? `${faceLabel}${personName ? ` · ${personName}` : ''} · ${score.toFixed(1)}%`
        : faceLabel;
      if (result.reference_id && hasSimilarity) {
        faceBox.title = `Webcam-only reference ${result.reference_id}; relative similarity, not a confirmed identity match.`;
      } else {
        faceBox.removeAttribute('title');
      }
      faceBox.appendChild(label);
    });
    for (const [faceId, faceBox] of faceElements) {
      if (!activeFaceIds.has(faceId)) {
        faceBox.remove();
        faceElements.delete(faceId);
      }
    }
  }
  function renderDetectionStatus(items=[]){
    if (!items.length) {
      resultsEl.replaceChildren(Object.assign(document.createElement('div'), {
        className: 'empty',
        textContent: 'No face detected in this frame. Face the camera directly, move closer, and improve the lighting.'
      }));
      return;
    }
    const counts = { POTENTIAL_MATCH: 0, NO_RELEVANT_MATCH: 0, INSUFFICIENT_QUALITY: 0 };
    items.forEach(item => { if (counts[item.status] !== undefined) counts[item.status] += 1; });
    const message = [
      counts.POTENTIAL_MATCH ? `${counts.POTENTIAL_MATCH} potential match${counts.POTENTIAL_MATCH === 1 ? '' : 'es'}` : null,
      counts.NO_RELEVANT_MATCH ? `${counts.NO_RELEVANT_MATCH} no relevant match${counts.NO_RELEVANT_MATCH === 1 ? '' : 'es'}` : null,
      counts.INSUFFICIENT_QUALITY ? `${counts.INSUFFICIENT_QUALITY} low-quality face${counts.INSUFFICIENT_QUALITY === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join('; ');
    const summary = Object.assign(document.createElement('div'), {
      className: 'empty',
      textContent: `AI Evidence Indicators: ${message || 'No actionable evidence found.'}`
    });
    const candidates = document.createElement('div');
    candidates.className = 'webcam-candidates';
    const hasRankedLeads = items.some(item => item.ranked_matches?.length);
    items.forEach((item, index) => {
      const result = document.createElement('div');
      result.className = `result webcam-result${item.status === 'POTENTIAL_MATCH' ? ' webcam-result-potential' : ''}`;
      if (item.ranked_matches?.length) {
        const topMatch = [...item.ranked_matches].sort((a, b) =>
          Number(b.similarity_score || 0) - Number(a.similarity_score || 0)
        )[0];
        const reviewNote = document.createElement('p');
        reviewNote.className = 'webcam-review-note';
        reviewNote.textContent = `Face ${String(item.index || index + 1).padStart(2, '0')}: webcam-only reference lead. Human review is required; similarity is not proof of identity.`;
        result.appendChild(reviewNote);
        const rankedCards = document.createElement('div');
        rankedCards.innerHTML = renderWebcamReferenceMatch(topMatch);
        result.appendChild(rankedCards);
        rankedCards.querySelectorAll('[data-webcam-verify]').forEach(verifyButton => {
          verifyButton.addEventListener('click', async () => {
            verifyButton.disabled = true;
            try {
              const candidate = item.ranked_matches.find(match => match.case?.case_id === verifyButton.dataset.caseId);
              if (!candidate) throw new Error('Could not find this similarity result.');
              let matchId = candidate.match_id;
              if (!matchId) {
                const response = await api(`/api/ai/webcam/session/${encodeURIComponent(webcamState.sessionId)}/review`, {
                  method: 'POST',
                  headers: {'Content-Type':'application/json'},
                  body: JSON.stringify({case_id: candidate.case.case_id, similarity_score: candidate.similarity_score})
                });
                matchId = response.match_id;
                candidate.match_id = matchId;
              }
              await openInvestigatorMatch(matchId);
            } catch (error) {
              toast(error.message || 'Could not open the verification form.');
              verifyButton.disabled = false;
            }
          });
        });
        candidates.appendChild(result);
        return;
      }
      const label = document.createElement('div');
      const scoreAvailable = item.similarity_score !== null && item.similarity_score !== undefined
        && Number.isFinite(Number(item.similarity_score));
      const score = scoreAvailable ? ` · ${Number(item.similarity_score).toFixed(1)}% similarity` : '';
      const reference = item.case_id ? `Closest reference: ${item.case_id}${score}. This is not a confirmed match.` : 'No reference case was available for comparison.';
      label.textContent = `Face ${String(item.index || index + 1).padStart(2, '0')} · ${item.status.replaceAll('_', ' ')} · ${reference}`;
      result.appendChild(label);
      candidates.appendChild(result);
    });
    resultsEl.replaceChildren(...(hasRankedLeads ? [candidates] : [summary, candidates]));
  }
  function renderWebcamSimilarityChart(matches){
    const chart = document.createElement('div');
    chart.className = 'webcam-similarity-chart';
    const heading = document.createElement('h5');
    heading.textContent = 'Ranked identification leads';
    chart.appendChild(heading);
    [...matches].sort((a,b)=>Number(b.similarity_score)-Number(a.similarity_score)).forEach((match,index)=>{
      const row = document.createElement('div');
      row.className = 'webcam-chart-row';
      const rank = document.createElement('span');
      rank.textContent = `Lead ${index + 1}`;
      const track = document.createElement('div');
      track.className = 'webcam-chart-track';
      const bar = document.createElement('span');
      bar.style.width = `${Math.max(0, Math.min(100, Number(match.similarity_score) || 0))}%`;
      track.appendChild(bar);
      const score = document.createElement('strong');
      score.textContent = `${Number(match.similarity_score || 0).toFixed(1)}%`;
      row.append(rank, track, score);
      chart.appendChild(row);
    });
    return chart;
  }
  function removeClosedWebcamMatches(faces=[]){
    const isClosed = status => String(status || '').toUpperCase().replaceAll(' ', '_') === 'CLOSED';
    return faces.map(face=>{
      const originalMatches=face.ranked_matches || [];
      const openMatches=originalMatches.filter(match=>!isClosed(match.case?.status || match.person?.status));
      const directClosed=isClosed(face.matched_person?.status)
        || originalMatches.some(match=>isClosed(match.case?.status || match.person?.status));
      if (openMatches.length) {
        const best=openMatches.reduce((a,b)=>Number(a.similarity_score||0)>=Number(b.similarity_score||0)?a:b);
        return {...face,ranked_matches:openMatches,case_id:best.case?.case_id||best.person?.case_id||face.case_id,similarity_score:best.similarity_score,match_id:best.match_id||null};
      }
      if (directClosed) {
        return {...face,status:'NO_RELEVANT_MATCH',evidence_message:'Closed cases are excluded from webcam matching.',case_id:null,similarity_score:null,matched_person:null,match_id:null,ranked_matches:[],chart:null};
      }
      return {...face,ranked_matches:openMatches};
    });
  }
  async function processFrame({manual=false}={}){
    if (!webcamState.active || webcamState.processing || !video || !video.videoWidth) return;
    webcamState.processing = true; setProcessing(manual ? 'Capturing and analyzing frame…' : 'Active');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not prepare a webcam frame. Try reloading the page.');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (manual) {
        capturedFaces = [];
        previewOverlay.replaceChildren();
        capturedMatchEl.textContent = 'Finding the highest similarity result…';
        previewImage.src = canvas.toDataURL('image/jpeg', 0.95);
        previewEl.classList.remove('d-none');
      }
      const blob = await new Promise((resolve, reject) => {
        // Keep the camera's native resolution and use a high JPEG quality so
        // small facial details survive upload and server-side comparison.
        canvas.toBlob(frame => frame ? resolve(frame) : reject(new Error('Could not capture a webcam frame.')), 'image/jpeg', 0.95);
      });
      const form = new FormData(); form.append('frame', blob, 'webcam-frame.jpg'); form.append('session_id', webcamState.sessionId);
      const data = await api('/api/ai/webcam/process-frame', {method:'POST', body:form});
      if (!webcamState.active) return;
      const faces = removeClosedWebcamMatches(data.faces || []);
      renderFaceBoxes(faces);
      if (manual) {
        capturedFaces = faces;
        renderCapturedFaceBoxes(capturedFaces);
      }
      facesEl.textContent = String(data.faces_detected || 0);
      renderDetectionStatus(faces);
      if (manual) {
        const visibleMatches = [...resultsEl.querySelectorAll('.webcam-result')];
        if (visibleMatches.length) {
          capturedMatchEl.replaceChildren(...visibleMatches);
        } else {
          capturedMatchEl.textContent = faces.length
            ? 'No similar registered person was found for this captured frame.'
            : 'No face was detected in this captured frame.';
        }
      }
      if (manual) toast(faces.length ? 'Frame captured and analyzed.' : 'Frame captured. No face was detected. Try a clearer, well-lit view.');
    } catch (error) {
      toast(error.message || 'Webcam frame processing failed.');
    } finally {
      webcamState.processing = false; setProcessing('Idle'); syncWebcamControls();
    }
  }
  async function startWebcam(){
    if (webcamState.starting || webcamState.active) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Camera access is unavailable. Open the app on localhost or a secure HTTPS connection.');
      updateStatus('Unavailable');
      return;
    }
    webcamState.starting = true;
    updateStatus('Requesting camera access…');
    syncWebcamControls();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video:{
          facingMode:{ideal:webcamState.facingMode || 'user'},
          width:{ideal:1280}, height:{ideal:720}, frameRate:{ideal:30, max:30}
        },
        audio:false
      });
      video.srcObject = stream;
      await video.play();
      // Ask supported cameras to keep focus on faces at changing distances.
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && videoTrack.getCapabilities && videoTrack.applyConstraints) {
        const capabilities = videoTrack.getCapabilities();
        const advanced = {};
        if (capabilities.focusMode?.includes('continuous')) advanced.focusMode = 'continuous';
        if (capabilities.exposureMode?.includes('continuous')) advanced.exposureMode = 'continuous';
        if (Object.keys(advanced).length) {
          try { await videoTrack.applyConstraints({advanced:[advanced]}); } catch (_) { /* camera controls are optional */ }
        }
      }
      const sessionData = await api('/api/ai/webcam/start', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({})});
      webcamState.stream = stream;
      webcamState.sessionId = sessionData.session.session_id;
      webcamState.active = true; updateStatus('Active');
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
        if (webcamState.active) {
          toast('The camera disconnected. Check that it is still available and start the camera again.');
          void stopWebcam();
        }
      }, {once:true}));
      if (webcamState.intervalId) clearInterval(webcamState.intervalId);
      webcamState.intervalId = setInterval(processFrame, 2500);
      toast('Live face detection started.');
    } catch (error) {
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (video.srcObject === stream) video.srcObject = null;
      webcamState.stream = null;
      webcamState.sessionId = null;
      webcamState.active = false;
      const cameraErrors = {
        NotAllowedError: 'Camera access was blocked. Allow camera access for this site in your browser settings.',
        NotFoundError: 'No camera was found. Connect or enable a camera and try again.',
        NotReadableError: 'The camera is busy or could not be opened. Close other apps using it and try again.',
        OverconstrainedError: 'The selected camera does not support the requested mode. Try switching cameras.',
        SecurityError: 'Camera access requires localhost or a secure HTTPS connection.'
      };
      toast(cameraErrors[error.name] || error.message || 'Could not start the camera.');
      updateStatus('Start failed');
    } finally {
      webcamState.starting = false;
      syncWebcamControls();
    }
  }
  async function stopWebcam(){
    if (webcamState.intervalId) clearInterval(webcamState.intervalId);
    if (webcamState.stream) {
      webcamState.stream.getTracks().forEach(track => track.stop());
      webcamState.stream = null;
    }
    if (webcamState.sessionId) {
      try { await api('/api/ai/webcam/stop', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({session_id: webcamState.sessionId})}); } catch (error) { toast(error.message); }
    }
    webcamState.active = false; webcamState.sessionId = null; webcamState.processing = false; updateStatus('Inactive'); setProcessing('Idle'); video.srcObject = null; overlay.innerHTML=''; faceElements.clear(); resultsEl.innerHTML = '<div class="empty">Camera stopped. Press Start camera to resume monitoring.</div>';
    facesEl.textContent = '0';
    syncWebcamControls();
  }
  async function captureSingleFrame(){
    if (!webcamState.active) {
      toast('Start the camera before capturing a frame.');
      return;
    }
    if (!video || !video.videoWidth) {
      toast('The camera is starting. Wait until the live preview appears, then capture a frame.');
      return;
    }
    if (webcamState.processing) {
      toast('A frame is already being analyzed. Please wait for it to finish.');
      return;
    }
    await processFrame({manual:true});
  }
  startButton.onclick = startWebcam;
  stopButton.onclick = stopWebcam;
  captureButton.onclick = captureSingleFrame;
  switchButton.onclick = async ()=>{
    webcamState.facingMode = webcamState.facingMode === 'user' ? 'environment' : 'user';
    if (webcamState.active) {
      await stopWebcam();
      await startWebcam();
    }
  };
  resultsEl.innerHTML = '<div class="empty">No analysis yet. Start the camera to begin live detection.</div>';
  syncWebcamControls();
}

function reportSightingPreset(caseId){
  go('sighting');
  setTimeout(()=>{
    const input = document.querySelector('#sightingForm input[name="case_id"]');
    if (input) input.value = caseId;
  }, 120);
}

function viewCaseByCaseId(caseId){
  if (!cases || !cases.length) return;
  const person = cases.find(item => item.case_id === caseId);
  if (person) viewCase(person.id);
}

async function reviewPotentialMatch(matchId, caseId){
  if (matchId) {
    await openInvestigatorMatch(matchId);
    return;
  }
  try {
    const result = await api('/api/missing-persons?q=' + encodeURIComponent(caseId));
    const person = result.items.find(item => item.case_id === caseId);
    if (person) await viewCase(person.id);
    else toast('The case is no longer available.');
  } catch (error) {
    toast(error.message);
  }
}

async function dashboard(el){let s=await api('/api/dashboard/statistics');let caseUpdate='';try{let casesList=(await api('/api/missing-persons')).items, foundCases=casesList.filter(p=>String(p.status).toUpperCase().replace(/ /g,'_')==='PERSON_FOUND');if(foundCases.length){caseUpdate=`<div class="panel"><h4>Case Update</h4><div class="alert-ai"><strong>🟢 Person Found</strong><br><div class="mt-2">Case ID: ${foundCases[0].case_id}</div><div class="mt-1">An authorized investigator has verified a potential match associated with your case.</div><div class="mt-3 d-flex gap-2"><button class="btn btn-primary btn-sm" onclick="viewCase(${foundCases[0].id})">View Case</button><button class="btn btn-outline-primary btn-sm" onclick="go('notifications')">View Timeline</button></div></div></div>`;}}catch(e){}el.innerHTML=heading('Good day, '+me.name.split(' ')[0],'A live overview of your authorized JanRaksha activity.')+`<div class="stat-grid"><div class="stat"><i class="fa-solid fa-folder-open"></i><small>Total cases</small><h2>${s.total_cases}</h2></div><div class="stat"><i class="fa-solid fa-person-circle-question"></i><small>Active cases</small><h2>${s.active_cases}</h2></div><div class="stat"><i class="fa-solid fa-eye"></i><small>New sightings</small><h2>${s.new_sightings}</h2></div><div class="stat"><i class="fa-solid fa-wand-magic-sparkles"></i><small>Potential matches</small><h2>${s.potential_matches}</h2></div></div>${caseUpdate}<div class="panel"><h4>Responsible AI</h4><div class="alert-ai">Similarity scores are AI-assisted leads only. They must never be treated as identity confirmation without authorized human review.</div></div><div class="panel"><h4>Quick actions</h4><button class="btn btn-primary btn-sm me-2" onclick="go('register-case')">Register a case</button><button class="btn btn-outline-primary btn-sm" onclick="go('search')">AI photo search</button></div>`}
async function gallery(el){let r=await api('/api/missing-persons');cases=r.items;el.innerHTML=heading('Missing persons','Search authorized case records and follow active leads.')+`<input id="caseSearch" placeholder="Search by name, case ID or location"><div id="cards" class="case-grid mt-3"></div>`;let render=()=>{$('#cards').innerHTML=cases.filter(p=>(p.name+p.case_id+(p.last_seen_location||'')).toLowerCase().includes($('#caseSearch').value.toLowerCase())).map(card).join('')||'<div class="empty">No matching cases.</div>'};$('#caseSearch').oninput=render;render()}
const card=p=>`<article class="case-card"><img src="${p.photo||''}" alt="Photo for ${p.name}"><div class="inner"><span class="badge-status">${p.status}</span><h4 class="mt-2">${p.name}</h4><small class="text-muted">${p.case_id} · ${p.age||'—'} years · ${p.gender||'—'}</small><p class="small mt-2 mb-2"><i class="fa-solid fa-location-dot"></i> ${p.last_seen_location||'Location restricted'}</p><button class="btn btn-outline-primary btn-sm" onclick="viewCase(${p.id})">View case</button></div></article>`;
async function viewCase(id){
  let r=await api('/api/missing-persons/'+id),p=r.person;
  const canSetPersonFound=['INVESTIGATOR','ADMIN_DEMO'].includes(me.role);
  const isPersonFound=['PERSON_FOUND','PERSON FOUND'].includes(p.status);
  const foundStatusOption=canSetPersonFound?`<option value="PERSON_FOUND" ${isPersonFound?'selected':''}>PERSON FOUND (verified)</option>`:isPersonFound?'<option value="PERSON_FOUND" selected disabled>PERSON FOUND (verified)</option>':'';
  const statusControl=r.permissions?.can_update_status?`<label for="status">Update case status</label><select id="status"><option value="ACTIVE" ${p.status==='ACTIVE'?'selected':''}>ACTIVE</option><option value="UNDER REVIEW" ${p.status==='UNDER REVIEW'?'selected':''}>UNDER REVIEW</option><option value="RELEVANT LEAD" ${p.status==='RELEVANT LEAD'?'selected':''}>RELEVANT LEAD</option><option value="CLOSED" ${p.status==='CLOSED'?'selected':''}>CLOSED</option>${foundStatusOption}</select><button class="btn btn-primary btn-sm mt-2" onclick="updateStatus(${p.id})">Update status</button>${['FAMILY_USER','POLICE_OFFICER'].includes(me.role)?'<p class="small text-muted mt-2">You can update case progress. An investigator must verify a person-found status.</p>':''}`:'';
  const noteControls=r.permissions?.can_add_notes?`<textarea id="note" placeholder="Restricted investigation note"></textarea><button class="btn btn-outline-primary btn-sm mt-2" onclick="addNote('${p.case_id}')">Add note</button>`:'';
  $('#page').innerHTML=heading(p.name,p.case_id)+`<div class="panel"><div class="row g-4"><div class="col-md-3"><img class="img-fluid rounded" src="${p.photo}" alt="${p.name}"></div><div class="col-md-9"><span class="badge-status">${String(p.status).replace(/_/g,' ')}</span><h4 class="mt-2">Last seen: ${p.last_seen_location||'Not shared'}</h4><p>${p.description||'No additional public description.'}</p>${statusControl}${noteControls}</div></div></div><div class="panel"><h4>Investigation timeline</h4><div class="timeline">${r.timeline.map(x=>`<div class="event"><b>${x.event_type.replaceAll('_',' ')}</b><br><span class="text-muted small">${new Date(x.created_at).toLocaleString()} · ${x.description}</span></div>`).join('')||'No events yet.'}</div></div>`
}
async function updateStatus(id){try{await api('/api/missing-persons/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:$('#status').value})});toast('Case status updated.');viewCase(id)}catch(e){toast(e.message)}}
async function addNote(caseId){try{await api('/api/cases/'+caseId+'/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:$('#note').value})});toast('Restricted note added.')}catch(e){toast(e.message)}}

async function openInvestigatorMatch(matchId){
  try {
    const match = await api('/api/matches/' + matchId);
    const p = match.missing_person;
    const report = match.report || {};
    const isWebcamMatch = match.source_type === 'WEBCAM';
    const reportPhoto = report.photo || (isWebcamMatch ? '' : p.photo || '');
    const reportName = report.reporter ? report.reporter.name : 'Reported / Found Person';
    const page = $('#page');
    page.innerHTML = `
      <div class="panel">
        <h1 class="page-title">Human Verification Required</h1>
        <div class="row g-4 mt-2">
          <div class="col-lg-6">
            <div class="panel border">
              <h4>Registered Missing Person</h4>
              <img src="${p.photo || ''}" alt="${p.name}" class="img-fluid rounded mb-3" style="max-height:240px;object-fit:cover;width:100%;">
              <dl class="row small">
                <dt class="col-5">Name</dt><dd class="col-7">${p.name}</dd>
                <dt class="col-5">Age</dt><dd class="col-7">${p.age || '—'}</dd>
                <dt class="col-5">Gender</dt><dd class="col-7">${p.gender || '—'}</dd>
                <dt class="col-5">Case ID</dt><dd class="col-7">${p.case_id}</dd>
                <dt class="col-5">Last seen location</dt><dd class="col-7">${p.last_seen_location || 'Not shared'}</dd>
                <dt class="col-5">Last seen</dt><dd class="col-7">${p.last_seen_date || '—'} ${p.last_seen_time || ''}</dd>
                <dt class="col-5">Description</dt><dd class="col-7">${p.description || '—'}</dd>
              </dl>
            </div>
          </div>
          <div class="col-lg-6">
            <div class="panel border">
              <h4>${isWebcamMatch ? 'Live Webcam Detection' : 'Reported / Found Person'}</h4>
              ${reportPhoto ? `<img src="${reportPhoto}" alt="Reported person" class="img-fluid rounded mb-3" style="max-height:240px;object-fit:cover;width:100%;">` : '<div class="empty mb-3">Webcam frames are not retained. Review the case information and independently verify any sighting.</div>'}
              <dl class="row small">
                <dt class="col-5">Source</dt><dd class="col-7">${isWebcamMatch ? 'AI-assisted webcam detection' : match.source_type || 'FOUND_PERSON'}</dd>
                <dt class="col-5">Reported location</dt><dd class="col-7">${report.location_name || 'Not shared'}</dd>
                <dt class="col-5">Reported date/time</dt><dd class="col-7">${report.reported_at ? new Date(report.reported_at).toLocaleString() : '—'}</dd>
                <dt class="col-5">${isWebcamMatch ? 'Monitoring investigator' : 'Reporter'}</dt><dd class="col-7">${reportName}</dd>
                ${report.session_id ? `<dt class="col-5">Session ID</dt><dd class="col-7">${report.session_id}</dd>` : ''}
                ${report.monitoring_description ? `<dt class="col-5">Monitoring notes</dt><dd class="col-7">${report.monitoring_description}</dd>` : ''}
              </dl>
            </div>
          </div>
        </div>

        <div class="panel mt-4">
          <h4>AI-Assisted Analysis</h4>
          <div class="row g-3">
            <div class="col-md-3"><strong>Face Similarity:</strong> ${Number(match.similarity_score || 0).toFixed(1)}%</div>
            <div class="col-md-3"><strong>Result:</strong> Potential Match</div>
            <div class="col-md-3"><strong>Review:</strong> Requires Human Verification</div>
          </div>
          <div class="alert-ai mt-3">
            <strong>AI Assessment:</strong> Potential Match<br>
            <div class="mt-2">Important notice: AI results are assistive and require human verification. Similarity scores do not constitute definitive identity confirmation.</div>
          </div>
        </div>

        <div class="d-flex gap-2 mt-4">
          <button class="btn btn-primary" id="verify-match-btn">VERIFY AS MATCH</button>
          <button class="btn btn-outline-secondary" id="mark-not-relevant-btn">MARK NOT RELEVANT</button>
        </div>
      </div>`;

    const verificationModal = document.createElement('div');
    verificationModal.id = 'verify-modal';
    verificationModal.className = 'd-none';
    verificationModal.innerHTML = `
      <div class="auth-modal" style="display:flex;align-items:center;justify-content:center;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:1000;">
        <div class="auth-box" style="max-width:560px;">
          <h2>Verify Potential Match</h2>
          <p>You are about to verify this potential match. Review the available information and confirm whether the person corresponds to the missing-person case.</p>
          <textarea id="verification-notes" class="form-control mb-3" rows="4" placeholder="Human verification notes"></textarea>
          <label class="check mb-3"><input id="verification-confirmation" type="checkbox"> I have reviewed the AI-assisted result and supporting case information.</label>
          <div class="d-flex justify-content-end gap-2">
            <button type="button" class="btn btn-outline-secondary" id="cancel-verification">Cancel</button>
            <button type="button" class="btn btn-primary" id="confirm-verification" disabled>Confirm Verification</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(verificationModal);

    document.getElementById('verification-confirmation').addEventListener('change', function(){
      document.getElementById('confirm-verification').disabled = !this.checked;
    });
    document.getElementById('cancel-verification').addEventListener('click', ()=> verificationModal.classList.add('d-none'));
    document.getElementById('confirm-verification').addEventListener('click', async ()=> {
      const notes = document.getElementById('verification-notes').value.trim();
      if (!notes) {
        window.alert('Please enter human verification notes before confirming.');
        return;
      }
      const confirmButton = document.getElementById('confirm-verification');
      confirmButton.disabled = true;
      const verificationRequest = api('/api/matches/' + matchId + '/verify', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ decision: 'VERIFIED', notes })
      });
      verificationModal.classList.add('d-none');
      window.alert('Verification confirmed.');
      try {
        await verificationRequest;
        setTimeout(() => go('dashboard'), 350);
      } catch (error) {
        toast(`Verification could not be saved: ${error.message || 'request failed.'}`);
        verificationModal.classList.remove('d-none');
        confirmButton.disabled = false;
      }
    });

    document.getElementById('verify-match-btn').addEventListener('click', ()=> verificationModal.classList.remove('d-none'));
    document.getElementById('mark-not-relevant-btn').addEventListener('click', async ()=> {
      if (!window.confirm('Mark this match as not relevant? This will keep the case active and no person-found email will be sent.')) return;
      const result = await api('/api/matches/' + matchId + '/not-relevant', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ notes: 'AI potential match reviewed and marked not relevant.' })
      });
      toast(result.message || 'Match marked not relevant.');
      setTimeout(() => go('dashboard'), 350);
    });
  } catch (error) {
    $('#page').innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
  }
}

function personFields(){return `<label>Full name<input name="name" required></label><div class="row"><div class="col"><label>Age<input name="age" type="number" min="0"></label></div><div class="col"><label>Gender<select name="gender"><option>Not specified</option><option>Female</option><option>Male</option><option>Other</option></select></label></div></div><label>Photograph<div class="drop"><i class="fa-solid fa-cloud-arrow-up"></i> JPG or PNG, max 5 MB<input name="photo" type="file" accept="image/png,image/jpeg" required></div></label>`}
function caseForm(el){if(!['FAMILY_USER','INVESTIGATOR','ADMIN_DEMO','POLICE_OFFICER'].includes(me.role)){el.innerHTML=heading('Register missing person')+'<div class="alert alert-warning">Your role cannot register cases.</div>';return}el.innerHTML=heading('Register missing person','Create a secure case. The system will create the case ID and embedding.')+`<form id="caseForm" class="panel form-panel">${personFields()}<label>Last-seen location<input name="last_seen_location" required></label><div class="row"><div class="col"><label>Date<input name="last_seen_date" type="date"></label></div><div class="col"><label>Time<input name="last_seen_time" type="time"></label></div></div><label>Description<textarea name="description"></textarea></label><label>Clothing description<textarea name="clothing_description"></textarea></label><button class="btn btn-primary">Create case and process photo</button></form>`;$('#caseForm').onsubmit=e=>submitForm(e,'/api/missing-persons',r=>{toast(r.message);viewCase(r.person.id)})}
function renderMatchGrid(matches, isFound=false, reportId=null, isWebcam=false){if(!matches.length){return '<div class="empty">No potential matches found.</div>'}const ranked=matches.map(match=>({item:match.case||match.person||match,score:Number(match.similarity_score)||0,matchId:match.match_id})).sort((a,b)=>b.score-a.score);return `<div class="match-comparison">${ranked.map(({item,score,matchId},index)=>{const percent=Math.min(100,Math.max(0,score));const label=Number.isInteger(score)?score:score.toFixed(1);const action=isFound?`<div class="match-actions"><input id="verifyLocation-${item.case_id}" class="mb-2" placeholder="Verified location" value="${document.querySelector('#foundForm input[name=\'location_name\']')?.value||''}"><div class="d-flex gap-2"><button class="btn btn-sm btn-primary" onclick="verifyFoundReport(${reportId}, '${item.case_id}', true)">Yes, verified</button><button class="btn btn-sm btn-outline-secondary" onclick="verifyFoundReport(${reportId}, '${item.case_id}', false)">No, not this person</button></div></div>`:isWebcam?'<span class="webcam-review-note">Webcam-only reference · human review required</span>':`<button class="btn btn-link btn-sm p-0" onclick="viewCase(${item.id})">View case</button>`;const caseDetails=isWebcam?`${item.reference_id||item.case_id||''} · ${item.age??'—'} yrs${item.description?` · ${item.description}`:''}`:`${item.case_id||''} · ${item.age??'—'} yrs · ${item.last_seen_location||'Location not shared'}`;const badge=isWebcam?'WEBCAM ONLY · REVIEW REQUIRED':item.status||'POTENTIAL MATCH';return `<article class="match-row"><div class="match-rank" aria-label="Rank ${index+1}">${index+1}</div><img class="match-photo" src="${item.photo||''}" alt="Photo for ${item.name||'potential match'}"><div class="match-details"><div class="match-heading"><div><h5>${item.name||'Unknown person'}</h5><small>${caseDetails}</small></div><strong class="score-pill">${label}%</strong></div><div class="score-panel"><div class="score-labels"><span>Similarity score</span><strong>${label}%</strong></div><div class="score-bar" role="meter" aria-label="Similarity score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span class="score-fill" style="width:${percent}%"></span></div></div><div class="match-footer"><span class="badge-status">${badge}</span>${action}</div></div></article>`}).join('')}</div>`;}
function renderWebcamReferenceMatch(match){
  const person=match.case||match.person||{};
  const score=Math.min(100,Math.max(0,Number(match.similarity_score)||0));
  const details=[person.reference_id||person.case_id,person.age===null||person.age===undefined?'':`${person.age} years`,person.description||''].filter(Boolean).join(' · ');
  return `<div class="match-comparison"><article class="match-row"><div class="match-rank" aria-label="Webcam reference">•</div><img class="match-photo" src="${escapeHtml(person.photo||'')}" alt="Registered webcam reference"><div class="match-details"><div class="match-heading"><div><h5>${escapeHtml(person.name||'Registered person')}</h5><small>${escapeHtml(details)}</small></div><strong class="score-pill">${score.toFixed(1)}%</strong></div><div class="score-panel"><div class="score-labels"><span>Relative similarity</span><strong>${score.toFixed(1)}%</strong></div><div class="score-bar" role="meter" aria-label="Relative similarity" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score}"><span class="score-fill" style="width:${score}%"></span></div></div><div class="match-footer"><span class="badge-status">WEBCAM ONLY · MANUAL IDENTITY CHECK</span></div></div></article></div>`;
}
function search(el){el.innerHTML=heading('AI photo search','Upload a photo to search authorized missing-person embeddings.')+`<div class="alert-ai">AI-generated results are potential leads and require human verification. A similarity score is not an identity decision.</div><form id="searchForm" class="panel form-panel"><label>Query photograph<input name="photo" type="file" accept="image/png,image/jpeg" required></label><label>Exclude existing case ID (optional)<input name="exclude_case_id" placeholder="JR-2026-0001"></label><button class="btn btn-primary">Process and search</button></form><div id="results"></div>`;$('#searchForm').onsubmit=e=>submitForm(e,'/api/ai/search',r=>{$('#results').innerHTML=`<div class="panel"><h4>Ranked potential matches</h4><p class="small text-muted">Sorted by AI similarity score. Results are leads, not identity confirmation.</p>${r.chart?`<img class="match-chart" src="${r.chart}" alt="Seaborn chart comparing similarity scores by case">`:''}${renderMatchGrid(r.matches, false)}</div>`})}
function sightingForm(el){el.innerHTML=heading('Report a sighting','Submit a lead for authorized review. Location details are access controlled.')+`<form id="sightingForm" class="panel form-panel"><label>Related case ID<input name="case_id" placeholder="JR-2026-0001" required></label><label>Photo (optional)<input name="photo" type="file" accept="image/png,image/jpeg"></label><label>Description<textarea name="description" required></textarea></label><label>Location name<input name="location_name" required></label><button class="btn btn-primary">Submit sighting</button></form>`;$('#sightingForm').onsubmit=e=>submitForm(e,'/api/sightings',r=>toast(r.message))}
function foundForm(el){el.innerHTML=heading('Report found person','This creates an AI-assisted lead only. Citizens cannot mark a case as found without human verification.')+`<form id="foundForm" class="panel form-panel"><label>Photograph<input name="photo" type="file" accept="image/png,image/jpeg" required></label><label>Exclude existing case ID (optional)<input name="exclude_case_id" placeholder="JR-2026-0001"></label><label>Description<textarea name="description"></textarea></label><label>Current location<input name="location_name" required></label><button class="btn btn-primary">Submit and find potential matches</button></form><div id="foundResults"></div>`;$('#foundForm').onsubmit=e=>submitForm(e,'/api/found-persons',r=>{$('#foundResults').innerHTML=`<div class="panel"><h4>Ranked potential matches</h4><p class="small text-muted">A human must confirm the match before any email alert is sent.</p>${r.chart?`<img class="match-chart" src="${r.chart}" alt="Seaborn chart comparing similarity scores by case">`:''}${renderMatchGrid(r.matches, true, r.report_id)}</div>`;toast(r.message)})}
async function verifyFoundReport(reportId, caseId, verified){const locationInput=document.getElementById('verifyLocation-'+caseId);const payload={case_id:caseId,verified};if(verified){payload.location_name=(locationInput&&locationInput.value.trim())||document.querySelector('#foundForm input[name="location_name"]').value.trim();if(!payload.location_name){toast('Please add the verified location before confirming.');return;}}try{const result=await api(`/api/found-persons/${reportId}/verify`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});toast(result.message);if(verified){go('dashboard');}else{const foundPanel=document.querySelector('#foundResults');if(foundPanel)foundPanel.scrollIntoView({behavior:'smooth'});}}catch(e){toast(e.message)}}
async function map(el){let r=await api('/api/maps/events');el.innerHTML=heading('Investigation map','Approximate authorized event locations only.')+`<div class="panel"><div id="mapEvents">${r.events.map(x=>`<div class="result"><i class="fa-solid ${x.type==='sighting'?'fa-eye':'fa-location-dot'}"></i><div><b>${x.case_id}</b><br><small>${x.type.replace('_',' ')} · ${x.location||'Location unavailable'}</small></div><span class="badge-status">${x.status}</span></div>`).join('')||'<div class="empty">No location events available.</div>'}</div></div>`}
async function notifications(el){let r=await api('/api/notifications');el.innerHTML=heading('Notifications','Your case and workflow updates.')+`<div class="panel">${r.items.map(n=>`<div class="result"><i class="fa-solid fa-bell"></i><div><b>${n.title}</b><br><small>${n.message}<br>${new Date(n.created_at).toLocaleString()}</small></div>${!n.is_read?`<button class="btn btn-sm btn-outline-primary" onclick="markRead(${n.id})">Mark read</button>`:''}</div>`).join('')||'<div class="empty">No notifications.</div>'}</div>`}async function markRead(id){await api('/api/notifications/'+id+'/read',{method:'PUT'});go('notifications')}
async function emergency(el, centerOnly=false){
  const dataLoads=await Promise.allSettled([
    api('/api/emergency-contacts'),
    api('/api/trusted-contacts'),
    api('/api/emergency/history')
  ]);
  const loadErrors=[];
  const dataOrEmpty=(result,label)=>{
    if(result.status==='fulfilled')return result.value;
    loadErrors.push(`${label}: ${result.reason.message}`);
    return {items:[]};
  };
  const contacts=dataOrEmpty(dataLoads[0],'Community contacts');
  const trusted=dataOrEmpty(dataLoads[1],'Trusted contacts');
  const history=dataOrEmpty(dataLoads[2],'Safety alert history');
  const admin=me.role==='ADMIN_DEMO';
  const defaultServices=[{name:'Accident',category:'ACCIDENT',icon:'fa-car-crash',tone:'accident'},{name:'Fire',category:'FIRE',icon:'fa-fire-flame-curved',tone:'fire'},{name:'Women Safety',category:'WOMEN_SAFETY',icon:'fa-person-dress',tone:'women'},{name:'Child Safety',category:'CHILD_SAFETY',icon:'fa-child-reaching',tone:'child'}];
  const serviceCards=defaultServices.map(service=>`<button type="button" class="safety-service-card ${service.tone}" data-emergency-category="${service.category}"><span class="safety-service-icon"><i class="fa-solid ${service.icon}"></i></span><span class="safety-service-label">${service.name}</span></button>`).join('');
  const serviceButton='<a class="btn btn-danger btn-block emergency-call-btn" href="tel:112">Call Emergency Services (112)</a>';
  const loadWarning=loadErrors.length?`<div class="alert alert-warning">Some supporting information could not be loaded. You can still submit an incident report.<br>${loadErrors.map(escapeHtml).join('<br>')}</div>`:'';
  const supportSections=`<div class="panel form-panel"><h4><i class="fa-solid fa-triangle-exclamation text-danger"></i> Activate safety alert</h4><p>Use only when you feel unsafe or need immediate assistance. Email alerts go to your registered account and trusted contacts when email delivery is configured.</p><label>Safety message<textarea id="sosMessage">I activated a safety alert and need assistance.</textarea></label><label>Location name<input id="sosLocation" placeholder="Getting your location…"></label><input id="sosLat" type="hidden"><input id="sosLng" type="hidden"><button id="sosButton" class="btn btn-danger">Send safety alert</button><div class="mt-3"><button type="button" id="enablePhoneNotifications" class="btn btn-outline-primary">Enable phone notifications</button><p id="phoneNotificationStatus" class="small text-muted mt-2 mb-0">Enable this on every phone or browser that should receive JanRaksha alerts. iPhone users must add the site to the Home Screen first.</p></div></div>
  <div class="panel form-panel"><h4>Safety community contacts</h4>${contacts.items.map(x=>`<div class="result"><i class="fa-solid fa-phone-volume"></i><div><b>${escapeHtml(x.name)}</b><br><small>${escapeHtml(x.region||'')}<br>${escapeHtml(x.instructions||'')}</small></div>${x.phone==='CONFIGURE'?'<span class="badge-status">Needs configuration</span>':`<a class="btn btn-danger ms-auto" href="tel:${x.phone.replace(/[^+0-9]/g,'')}">Call ${escapeHtml(x.phone)}</a>`}</div>`).join('')||'<div class="empty">No verified safety contacts configured.</div>'}</div>
  <div class="panel form-panel"><h4>Trusted contacts</h4><div>${trusted.items.map(x=>`<div class="result"><div><b>${escapeHtml(x.name)}</b><br><small>${escapeHtml(x.email||x.phone)}</small></div><button class="btn btn-sm btn-outline-danger ms-auto" onclick="removeTrusted(${x.id}, '${centerOnly?'emergency-center':'emergency'}')">Remove</button></div>`).join('')||'<div class="empty">No trusted contacts yet.</div>'}</div><form id="trustedForm"><label>Name<input name="name" required></label><label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label><button class="btn btn-outline-primary">Add trusted contact</button></form></div>
  <div class="panel form-panel"><h4>Safety alerts history</h4>${history.items.map(x=>`<div class="result"><div><b>Alert #${x.id} · ${escapeHtml(x.status)}</b><br><small>${escapeHtml(x.location_name||'Location unavailable')} · ${new Date(x.created_at).toLocaleString()}</small></div>${x.status==='ACTIVE'?`<button class="btn btn-outline-danger ms-auto" onclick="cancelSOS(${x.id}, '${centerOnly?'emergency-center':'emergency'}')">Cancel alert</button>`:''}</div>`).join('')||'<div class="empty">No safety alerts yet.</div>'}</div>${admin?`<form id="contactForm" class="panel form-panel"><h4>Configure community contact</h4><label>Name<input name="name" required></label><label>Phone<input name="phone" required></label><label>Region<input name="region" required></label><label>Instructions<textarea name="instructions"></textarea></label><button class="btn btn-primary">Save contact</button></form>`:''}`;
  if(centerOnly){
    el.innerHTML=heading('Emergency','Activate a safety alert and manage community and trusted contacts.')+loadWarning+
      `<button type="button" class="btn btn-outline-primary mb-3" id="openSafetyCommunity"><i class="fa-solid fa-people-group"></i> Safety Community reports</button>${supportSections}`;
  }else{
    const emergencyCard='<button type="button" class="safety-service-card emergency" data-open-emergency-center><span class="safety-service-icon"><i class="fa-solid fa-kit-medical"></i></span><span class="safety-service-label">Emergency</span></button>';
    el.innerHTML=heading('Safety Community','Emergency support, quick assistance, and trusted alert access for your area.')+loadWarning+`<div class="safety-community-shell"><div class="safety-community-header"><i class="fa-solid fa-triangle-exclamation"></i> Safety Community</div><p class="text-muted mb-3">Choose an incident type to open the report form.</p><div class="safety-grid">${serviceCards}${emergencyCard}</div><div class="safety-community-footer"><span>Call Emergency Services</span>${serviceButton}</div></div>
  <form id="emergencyReportForm" class="panel form-panel d-none"><h4>Report <span id="emergencyReportCategory"></span></h4><input name="category" id="emergencyCategory" type="hidden"><input name="submission_key" id="emergencySubmissionKey" type="hidden"><div class="row"><div class="col"><label>Your name<input name="reporter_name" maxlength="120" value="${escapeHtml(me.name)}" required></label></div><div class="col"><label>Phone or email<input name="reporter_contact" maxlength="160" value="${escapeHtml(me.phone||me.email)}"></label></div></div><label>Incident description<textarea name="description" maxlength="5000" required></textarea></label><label>Incident location<input name="location_name" id="reportLocation" maxlength="200" placeholder="Enter location or nearby landmark" required></label><label>Supporting image (optional)<input name="attachment" type="file" accept="image/png,image/jpeg"></label><div id="emergencyReportMessage" role="status" aria-live="polite"></div><button class="btn btn-primary" type="submit">Submit emergency report</button> <button class="btn btn-link" type="button" id="cancelEmergencyReport">Cancel</button></form>
  `;
  }
  if(centerOnly){
    $('#openSafetyCommunity').onclick=()=>go('emergency-community');
    const pushButton=$('#enablePhoneNotifications'),pushStatus=$('#phoneNotificationStatus');
    pushButton.disabled=true;pushStatus.textContent='Preparing phone notification setup…';
    phonePushSetup=preparePhonePush();
    phonePushSetup.then(()=>{pushButton.disabled=false;pushStatus.textContent='Ready to enable notifications on this phone or browser.'}).catch(error=>{pushStatus.textContent=error.message});
    pushButton.onclick=event=>enablePhoneNotifications(event.currentTarget);
  }
  const refreshCurrent=()=>emergency(el,centerOnly);
  const emergencyCenterButton=document.querySelector('[data-open-emergency-center]');
  if(emergencyCenterButton)emergencyCenterButton.onclick=()=>go('emergency-center');
  if(!centerOnly){
    document.querySelectorAll('[data-emergency-category]').forEach(button=>button.onclick=()=>{const form=$('#emergencyReportForm');$('#emergencyCategory').value=button.dataset.emergencyCategory;$('#emergencyReportCategory').textContent=button.querySelector('.safety-service-label').textContent;$('#emergencySubmissionKey').value=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`;form.classList.remove('d-none');form.scrollIntoView({behavior:'smooth',block:'center'})});
    $('#cancelEmergencyReport').onclick=()=>$('#emergencyReportForm').classList.add('d-none');
    $('#emergencyReportForm').onsubmit=async event=>{event.preventDefault();const form=event.target,button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Submitting…';$('#emergencyReportMessage').textContent='';try{const result=await api('/api/emergency/cases',{method:'POST',body:new FormData(form)});$('#emergencyReportMessage').innerHTML=`<div class="alert alert-success">${escapeHtml(result.message)} Case ID: <strong>${escapeHtml(result.case.case_id)}</strong></div>`;toast(result.message);setTimeout(()=>emergency(el),800)}catch(error){$('#emergencyReportMessage').innerHTML=`<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;button.disabled=false;button.textContent='Submit emergency report'}};
  }

  if(centerOnly){
    $('#sosButton').onclick=async()=>{try{let r=await api('/api/emergency/sos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:$('#sosMessage').value,location_name:$('#sosLocation').value})});toast(r.message);refreshCurrent()}catch(x){toast(x.message)}};
    $('#trustedForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/trusted-contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast('Trusted contact added.');refreshCurrent()}catch(x){toast(x.message)}};
    if(admin)$('#contactForm').onsubmit=e=>{e.preventDefault();api('/api/emergency-contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))}).then(()=>{toast('Safety contact saved.');refreshCurrent()}).catch(x=>toast(x.message))};
  }
}function showPolicePortalShell(){
  $('aside').classList.remove('d-none');
  $('.workspace').style.marginLeft='';
  const policePages=new Set(['dashboard','cases','register-case','search','webcam']);
  document.querySelectorAll('aside .nav-link').forEach(item=>{
    item.classList.toggle('d-none',!policePages.has(item.dataset.page)&&!item.classList.contains('logout'));
  });
  const labels={dashboard:'Emergency cases',cases:'Registered missing persons','register-case':'Register missing person',search:'AI search',webcam:'Live webcam'};
  document.querySelectorAll('aside .nav-link[data-page]').forEach(item=>{
    if(labels[item.dataset.page])item.lastChild.textContent=labels[item.dataset.page];
  });
  const logout=$('.logout');
  logout.innerHTML='<i class="fa-solid fa-arrow-right-from-bracket"></i>Police Portal logout';
  logout.onclick=async()=>{try{await api('/api/police/logout',{method:'POST'});location.reload()}catch(error){toast(error.message)}};
}

function policePortal(el){
  if(me&&['POLICE_OFFICER','ADMIN_DEMO'].includes(me.role))return policeDashboard(el);
  el.innerHTML=heading('Police Portal','Sign in with your authorized Police ID or registered email.')+`<form id="policeLoginForm" class="panel form-panel police-login-form"><div id="policeLoginError" role="alert"></div><label>Police ID or registered email<input name="identifier" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="btn btn-primary" type="submit">Police Portal login</button></form>`;
  $('#policeLoginForm').onsubmit=async event=>{
    event.preventDefault();
    const form=event.target,button=form.querySelector('button[type="submit"]');
    button.disabled=true;button.textContent='Signing in…';$('#policeLoginError').textContent='';
    try{
      const result=await api('/api/police/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
      me=result.user;$('#userName').textContent=me.name;$('#roleBadge').textContent='POLICE PORTAL';showPolicePortalShell();policeDashboard(el);
    }catch(error){$('#policeLoginError').innerHTML=`<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;button.disabled=false;button.textContent='Police Portal login'}
  };
}

function policeDashboard(el){
  el.innerHTML=heading('Police Portal','Emergency case management · refreshes automatically every 20 seconds.')+
    `<div class="police-dashboard-actions"><span class="badge-status">Signed in as ${escapeHtml(me.name)}</span></div>
    <div id="policeCaseSummary" class="police-stat-grid"></div>
    <form id="policeCaseFilters" class="panel police-filters"><label>Search case ID or description<input name="search" placeholder="Search cases"></label><label>Category<select name="category"><option value="">All categories</option>${[['ACCIDENT','Accident'],['FIRE','Fire'],['MEDICAL','Medical'],['POLICE','Police'],['WOMEN_SAFETY','Women Safety'],['CHILD_SAFETY','Child Safety']].map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><label>Status<select name="status"><option value="">All statuses</option><option value="PENDING">Pending</option><option value="IN_PROGRESS">In Progress</option><option value="RESOLVED">Resolved</option></select></label><label>From date<input type="date" name="from_date"></label><label>To date<input type="date" name="to_date"></label><button class="btn btn-primary btn-sm" type="submit">Apply filters</button><button class="btn btn-outline-secondary btn-sm" type="reset">Clear</button></form>
    <div id="policeCasesContainer"><div class="empty">Loading emergency cases…</div></div>
    ${me.role==='ADMIN_DEMO'?`<form id="policeOfficerForm" class="panel form-panel"><h4>Create police officer account</h4><p>For authorized administrators only. The password is hashed on the server and never returned.</p><label>Police ID<input name="police_id" maxlength="40" required></label><label>Officer name<input name="name" maxlength="120" required></label><label>Registered email<input name="email" type="email" maxlength="160" required></label><label>Contact phone<input name="phone"></label><label>Temporary password (at least 8 characters)<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><div id="policeOfficerMessage" role="status"></div><button class="btn btn-primary" type="submit">Create police account</button></form>`:''}`;
  $('#policeCaseFilters').onsubmit=event=>{event.preventDefault();loadPoliceCases(el,1)};
  $('#policeCaseFilters').onreset=()=>setTimeout(()=>loadPoliceCases(el,1),0);
  if(me.role==='ADMIN_DEMO')$('#policeOfficerForm').onsubmit=async event=>{
    event.preventDefault();
    const form=event.target,button=form.querySelector('button[type="submit"]');
    button.disabled=true;button.textContent='Creating account…';$('#policeOfficerMessage').textContent='';
    try{
      const result=await api('/api/police/officers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
      form.reset();$('#policeOfficerMessage').innerHTML=`<div class="alert alert-success">${escapeHtml(result.message)} Police ID: <strong>${escapeHtml(result.officer.police_id)}</strong></div>`;loadPoliceCases(el,1);
    }catch(error){$('#policeOfficerMessage').innerHTML=`<div class="alert alert-danger">${escapeHtml(error.message)}</div>`}
    finally{button.disabled=false;button.textContent='Create police account'}
  };
  loadPoliceCases(el,1);
  policeRefreshTimer=setInterval(()=>loadPoliceCases(el,window.policeCasePage||1,true),20000);
}

async function loadPoliceCases(el,page=1,silent=false){
  const container=$('#policeCasesContainer'),summary=$('#policeCaseSummary');
  if(!container||!summary)return;
  if(silent&&($('#policeCaseFilters').contains(document.activeElement)||container.contains(document.activeElement)||container.querySelector('details[open]')))return;
  const filters=new URLSearchParams(new FormData($('#policeCaseFilters')));
  filters.set('page',page);
  if(!silent)container.innerHTML='<div class="empty">Loading emergency cases…</div>';
  try{
    const response=await api('/api/police/cases?'+filters.toString());
    window.policeCasePage=response.page;
    summary.innerHTML=[['Total cases',response.counts.total],['Pending',response.counts.pending],['In progress',response.counts.in_progress],['Resolved',response.counts.resolved]].map(([label,count])=>`<div class="police-stat"><small>${label}</small><strong>${count}</strong></div>`).join('');
    if(!response.items.length){container.innerHTML='<div class="empty">No emergency reports match these filters.</div>';return}
    const officers=[`<option value="">Unassigned</option>`,...response.officers.map(officer=>`<option value="${officer.user_id}">${escapeHtml(officer.name)} · ${escapeHtml(officer.police_id)}</option>`)];
    const rows=response.items.map(item=>`<tr><td><strong>${escapeHtml(item.case_id)}</strong></td><td>${escapeHtml(item.category.replaceAll('_',' '))}</td><td><span class="badge-status">${escapeHtml(item.status.replaceAll('_',' '))}</span></td><td>${escapeHtml(item.reporter_name)}</td><td>${new Date(item.created_at).toLocaleString()}</td><td><details><summary>View details / update</summary><div class="police-case-details"><p><strong>Reporter:</strong> ${escapeHtml(item.reporter_name)} · ${escapeHtml(item.reporter_contact||'No contact provided')}</p><p><strong>Location:</strong> ${escapeHtml(item.location_name)}</p><p><strong>Description:</strong><br>${escapeHtml(item.description)}</p>${item.attachment?`<p><a href="${escapeHtml(item.attachment)}" target="_blank" rel="noopener">View supporting image</a></p>`:''}<form class="police-case-update" data-case-id="${escapeHtml(item.case_id)}"><label>Status<select name="status">${[['PENDING','Pending'],['IN_PROGRESS','In Progress'],['RESOLVED','Resolved']].map(([value,label])=>`<option value="${value}" ${item.status===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Assigned officer<select name="assigned_officer_id">${officers.map(option=>option.replace(/value="([^"]+)"/,(_,value)=>`value="${value}" ${String(item.assigned_officer_id||'')===value?'selected':''}`)).join('')}</select></label><button class="btn btn-primary btn-sm" type="submit">Save case update</button></form></div></details></td></tr>`).join('');
    const pages=Array.from({length:response.pages},(_,index)=>index+1).map(number=>`<button class="btn btn-sm ${number===response.page?'btn-primary':'btn-outline-primary'}" data-case-page="${number}">${number}</button>`).join('');
    container.innerHTML=`<div class="table-responsive panel police-case-table"><table class="table align-middle"><thead><tr><th>Case ID</th><th>Category</th><th>Status</th><th>Reporter</th><th>Submitted</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table><div class="police-pagination">${pages}</div></div>`;
    container.querySelectorAll('[data-case-page]').forEach(button=>button.onclick=()=>loadPoliceCases(el,Number(button.dataset.casePage)));
    container.querySelectorAll('.police-case-update').forEach(form=>form.onsubmit=async event=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');button.disabled=true;
      const data=Object.fromEntries(new FormData(form));data.assigned_officer_id=data.assigned_officer_id?Number(data.assigned_officer_id):null;
      try{const result=await api('/api/police/cases/'+encodeURIComponent(form.dataset.caseId),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});toast(result.message);loadPoliceCases(el,response.page)}
      catch(error){toast(error.message);button.disabled=false}
    });
  }catch(error){container.innerHTML=`<div class="alert alert-danger">${escapeHtml(error.message)}</div>`}
}

async function removeTrusted(id,returnPage='emergency'){try{await api('/api/trusted-contacts/'+id,{method:'DELETE'});go(returnPage)}catch(e){toast(e.message)}}async function cancelSOS(id,returnPage='emergency'){try{await api('/api/emergency/sos/'+id+'/cancel',{method:'PUT'});toast('SOS cancelled.');go(returnPage)}catch(e){toast(e.message)}}
async function submitForm(e,url,done){e.preventDefault();let b=e.target.querySelector('button[type="submit"],button:last-child');let old=b.textContent;b.disabled=true;b.textContent='Processing…';try{let r=await api(url,{method:'POST',body:new FormData(e.target)});done(r)}catch(x){toast(x.message)}finally{b.disabled=false;b.textContent=old}}
boot();
