let me=null, cases=[]; const $=s=>document.querySelector(s);
const api=async(url,opts={})=>{let r=await fetch(url,opts),d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Something went wrong.');return d};
const toast=m=>{let t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3200)};
function showAuth(which){$('#authView').classList.remove('d-none');$('#loginModal').classList.toggle('d-none',which!=='login');$('#registerModal').classList.toggle('d-none',which!=='register')};function hideAuth(){$('#loginModal').classList.add('d-none');$('#registerModal').classList.add('d-none')}
$('#loginForm').onsubmit=async e=>{e.preventDefault();try{let f=new FormData(e.target);await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(f))});boot()}catch(x){toast(x.message)}};
$('#registerForm').onsubmit=async e=>{e.preventDefault();try{let f=new FormData(e.target),d=Object.fromEntries(f);d.terms=f.get('terms')==='on';await api('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});boot()}catch(x){toast(x.message)}};
async function boot(){try{me=(await api('/api/users/me')).user}catch{return}$('#authView').classList.add('d-none');hideAuth();$('#appView').classList.remove('d-none');$('#userName').textContent=me.name;$('#roleBadge').textContent=me.role.replace('_',' ');const matchMatch = window.location.pathname.match(/\/investigator\/matches\/(\d+)/);if(matchMatch && ['INVESTIGATOR','ADMIN_DEMO'].includes(me.role)){return openInvestigatorMatch(Number(matchMatch[1]));}go('dashboard')}
document.querySelectorAll('.nav-link[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));$('.logout').onclick=async()=>{await api('/api/auth/logout',{method:'POST'});location.reload()};
const heading=(t,s='')=>`<h1 class="page-title">${t}</h1><p class="page-subtitle">${s}</p>`;
async function go(page){document.querySelectorAll('.nav-link').forEach(x=>x.classList.toggle('active',x.dataset.page===page));let el=$('#page');el.innerHTML='<div class="empty">Loading…</div>';try{if(page==='dashboard')return dashboard(el);if(page==='cases')return gallery(el);if(page==='register-case')return caseForm(el);if(page==='search')return search(el);if(page==='webcam')return webcamSearch(el);if(page==='sighting')return sightingForm(el);if(page==='found')return foundForm(el);if(page==='map')return map(el);if(page==='notifications')return notifications(el);if(page==='emergency')return emergency(el)}catch(e){el.innerHTML=`<div class="alert alert-danger">${e.message}</div>`}}

const webcamState={stream:null,active:false,starting:false,sessionId:null,processing:false,intervalId:null,facingMode:'user'};

async function webcamSearch(el){
  if (!['INVESTIGATOR','ADMIN_DEMO'].includes(me.role)) {
    el.innerHTML = heading('Live webcam crowd detection', 'Continuous crowd monitoring is restricted to authorized investigators and administrators.') + '<div class="alert alert-warning">Your role does not currently have permission to access live webcam monitoring.</div>';
    return;
  }
  el.innerHTML = heading('AI Evidence Indicators', 'Live face monitoring compares camera evidence against missing-person references without treating a score as a certainty claim.') + `
    <div class="alert-ai mb-3"><strong>AI Evidence Indicators:</strong> Green means a plausible relevant match that still requires human review, red means no relevant match in the current reference set, and yellow means the face quality is too low for a reliable comparison.</div>
    <div class="panel webcam-shell">
      <div class="webcam-controls">
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-primary" id="startCameraBtn">Start camera</button>
          <button class="btn btn-outline-secondary" id="stopCameraBtn">Stop camera</button>
          <button class="btn btn-outline-primary" id="captureFrameBtn">Capture frame</button>
          <button class="btn btn-outline-primary" id="switchCameraBtn">Switch camera</button>
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
      <div id="webcamResults" class="webcam-results mt-3"></div>
    </div>
  `;
  const video=$('#webcamVideo'); const overlay=$('#faceOverlay'); const statusEl=$('#cameraStatus'); const facesEl=$('#facesDetected'); const processEl=$('#processingStatus'); const resultsEl=$('#webcamResults'); const faceElements=new Map();
  const startButton=$('#startCameraBtn'); const stopButton=$('#stopCameraBtn'); const captureButton=$('#captureFrameBtn'); const switchButton=$('#switchCameraBtn');
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
      const statusClass = result.status === 'POTENTIAL_MATCH' ? 'potential' : result.status === 'NO_RELEVANT_MATCH' ? 'no-match' : result.status === 'INSUFFICIENT_QUALITY' ? 'warning' : 'neutral';
      faceBox.className = `face-box ${statusClass}`;
      faceBox.style.left = x + 'px'; faceBox.style.top = y + 'px'; faceBox.style.width = w + 'px'; faceBox.style.height = h + 'px';
      const label = document.createElement('div');
      label.className = 'face-label';
      label.textContent = faceId.startsWith('face_')
        ? 'Face ' + faceId.slice(5)
        : 'Face ' + String(index + 1).padStart(2, '0');
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
    resultsEl.replaceChildren(Object.assign(document.createElement('div'), {
      className: 'empty',
      textContent: `AI Evidence Indicators: ${message || 'No actionable evidence found.'}`
    }));
  }
  async function processFrame(){
    if (!webcamState.active || webcamState.processing || !video || !video.videoWidth) return;
    webcamState.processing = true; setProcessing('Active');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not prepare a webcam frame. Try reloading the page.');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(frame => frame ? resolve(frame) : reject(new Error('Could not capture a webcam frame.')), 'image/jpeg', 0.85);
      });
      const form = new FormData(); form.append('frame', blob, 'webcam-frame.jpg'); form.append('session_id', webcamState.sessionId);
      const data = await api('/api/ai/webcam/process-frame', {method:'POST', body:form});
      if (!webcamState.active) return;
      const faces = data.faces || [];
      renderFaceBoxes(faces);
      facesEl.textContent = String(data.faces_detected || 0);
      renderDetectionStatus(faces);
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
      stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:webcamState.facingMode || 'user'}, audio:false});
      video.srcObject = stream;
      await video.play();
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
    if (!webcamState.active || !video || !video.videoWidth) {
      toast('Start the camera before capturing a frame.');
      return;
    }
    await processFrame();
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
async function viewCase(id){let r=await api('/api/missing-persons/'+id),p=r.person;$('#page').innerHTML=heading(p.name,p.case_id)+`<div class="panel"><div class="row g-4"><div class="col-md-3"><img class="img-fluid rounded" src="${p.photo}" alt="${p.name}"></div><div class="col-md-9"><span class="badge-status">${String(p.status).replace(/_/g,' ')}</span><h4 class="mt-2">Last seen: ${p.last_seen_location||'Not shared'}</h4><p>${p.description||'No additional public description.'}</p>${['INVESTIGATOR','ADMIN_DEMO'].includes(me.role)?`<select id="status"><option>${String(p.status).replace(/_/g,' ')}</option><option>ACTIVE</option><option>UNDER REVIEW</option><option>RELEVANT LEAD</option><option>PERSON FOUND</option><option>PERSON_FOUND</option><option>CLOSED</option></select><button class="btn btn-primary btn-sm mt-2" onclick="updateStatus(${p.id})">Update status</button><textarea id="note" placeholder="Restricted investigation note"></textarea><button class="btn btn-outline-primary btn-sm mt-2" onclick="addNote('${p.case_id}')">Add note</button>`:''}</div></div></div><div class="panel"><h4>Investigation timeline</h4><div class="timeline">${r.timeline.map(x=>`<div class="event"><b>${x.event_type.replaceAll('_',' ')}</b><br><span class="text-muted small">${new Date(x.created_at).toLocaleString()} · ${x.description}</span></div>`).join('')||'No events yet.'}</div></div>`}
async function updateStatus(id){try{await api('/api/missing-persons/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:$('#status').value})});toast('Case status updated.');viewCase(id)}catch(e){toast(e.message)}}async function addNote(caseId){try{await api('/api/cases/'+caseId+'/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:$('#note').value})});toast('Restricted note added.')}catch(e){toast(e.message)}}

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
          <p>You are about to verify this potential match. Confirm that you have reviewed the available information and believe the submitted person corresponds to the missing-person case.</p>
          <textarea id="verification-notes" class="form-control mb-3" rows="4" placeholder="Investigator verification notes"></textarea>
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
        toast('Verification notes are required.');
        return;
      }
      const result = await api('/api/matches/' + matchId + '/verify', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ decision: 'VERIFIED', notes })
      });
      toast(result.message || '✓ Match Verified Successfully');
      verificationModal.classList.add('d-none');
      setTimeout(() => go('dashboard'), 350);
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
function caseForm(el){if(!['FAMILY_USER','INVESTIGATOR','ADMIN_DEMO'].includes(me.role)){el.innerHTML=heading('Register missing person')+'<div class="alert alert-warning">Your role cannot register cases.</div>';return}el.innerHTML=heading('Register missing person','Create a secure case. The system will create the case ID and embedding.')+`<form id="caseForm" class="panel form-panel">${personFields()}<label>Last-seen location<input name="last_seen_location" required></label><div class="row"><div class="col"><label>Latitude<input name="latitude" type="number" step="any"></label></div><div class="col"><label>Longitude<input name="longitude" type="number" step="any"></label></div></div><div class="row"><div class="col"><label>Date<input name="last_seen_date" type="date"></label></div><div class="col"><label>Time<input name="last_seen_time" type="time"></label></div></div><label>Description<textarea name="description"></textarea></label><label>Clothing description<textarea name="clothing_description"></textarea></label><button class="btn btn-primary">Create case and process photo</button></form>`;$('#caseForm').onsubmit=e=>submitForm(e,'/api/missing-persons',r=>{toast(r.message);viewCase(r.person.id)})}
function renderMatchGrid(matches, isFound=false, reportId=null){if(!matches.length){return '<div class="empty">No potential matches found.</div>'}const ranked=matches.map(match=>({item:match.case||match.person||match,score:Number(match.similarity_score)||0})).sort((a,b)=>b.score-a.score);return `<div class="match-comparison">${ranked.map(({item,score},index)=>{const percent=Math.min(100,Math.max(0,score));const label=Number.isInteger(score)?score:score.toFixed(1);const action=isFound?`<div class="match-actions"><input id="verifyLocation-${item.case_id}" class="mb-2" placeholder="Verified location" value="${document.querySelector('#foundForm input[name=\'location_name\']')?.value||''}"><div class="d-flex gap-2"><button class="btn btn-sm btn-primary" onclick="verifyFoundReport(${reportId}, '${item.case_id}', true)">Yes, verified</button><button class="btn btn-sm btn-outline-secondary" onclick="verifyFoundReport(${reportId}, '${item.case_id}', false)">No, not this person</button></div></div>`:`<button class="btn btn-link btn-sm p-0" onclick="viewCase(${item.id})">View case</button>`;return `<article class="match-row"><div class="match-rank" aria-label="Rank ${index+1}">${index+1}</div><img class="match-photo" src="${item.photo||''}" alt="Photo for ${item.name||'potential match'}"><div class="match-details"><div class="match-heading"><div><h5>${item.name||'Unknown person'}</h5><small>${item.case_id||''} · ${item.age??'—'} yrs · ${item.last_seen_location||'Location not shared'}</small></div><strong class="score-pill">${label}%</strong></div><div class="score-panel"><div class="score-labels"><span>Similarity score</span><strong>${label}%</strong></div><div class="score-bar" role="meter" aria-label="Similarity score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span class="score-fill" style="width:${percent}%"></span></div></div><div class="match-footer"><span class="badge-status">${item.status||'POTENTIAL MATCH'}</span>${action}</div></div></article>`}).join('')}</div>`;}
function search(el){el.innerHTML=heading('AI photo search','Upload a photo to search authorized missing-person embeddings.')+`<div class="alert-ai">AI-generated results are potential leads and require human verification. A similarity score is not an identity decision.</div><form id="searchForm" class="panel form-panel"><label>Query photograph<input name="photo" type="file" accept="image/png,image/jpeg" required></label><label>Exclude existing case ID (optional)<input name="exclude_case_id" placeholder="JR-2026-0001"></label><button class="btn btn-primary">Process and search</button></form><div id="results"></div>`;$('#searchForm').onsubmit=e=>submitForm(e,'/api/ai/search',r=>{$('#results').innerHTML=`<div class="panel"><h4>Ranked potential matches</h4><p class="small text-muted">Sorted by AI similarity score. Results are leads, not identity confirmation.</p>${r.chart?`<img class="match-chart" src="${r.chart}" alt="Seaborn chart comparing similarity scores by case">`:''}${renderMatchGrid(r.matches, false)}</div>`})}
function sightingForm(el){el.innerHTML=heading('Report a sighting','Submit a lead for authorized review. Location details are access controlled.')+`<form id="sightingForm" class="panel form-panel"><label>Related case ID<input name="case_id" placeholder="JR-2026-0001" required></label><label>Photo (optional)<input name="photo" type="file" accept="image/png,image/jpeg"></label><label>Description<textarea name="description" required></textarea></label><label>Location name<input name="location_name" required></label><div class="row"><div class="col"><label>Latitude<input name="latitude" type="number" step="any"></label></div><div class="col"><label>Longitude<input name="longitude" type="number" step="any"></label></div></div><button class="btn btn-primary">Submit sighting</button></form>`;$('#sightingForm').onsubmit=e=>submitForm(e,'/api/sightings',r=>toast(r.message))}
function foundForm(el){el.innerHTML=heading('Report found person','This creates an AI-assisted lead only. Citizens cannot mark a case as found without human verification.')+`<form id="foundForm" class="panel form-panel"><label>Photograph<input name="photo" type="file" accept="image/png,image/jpeg" required></label><label>Exclude existing case ID (optional)<input name="exclude_case_id" placeholder="JR-2026-0001"></label><label>Description<textarea name="description"></textarea></label><label>Current location<input name="location_name" required></label><div class="row"><div class="col"><label>Latitude<input name="latitude" type="number" step="any"></label></div><div class="col"><label>Longitude<input name="longitude" type="number" step="any"></label></div></div><button class="btn btn-primary">Submit and find potential matches</button></form><div id="foundResults"></div>`;$('#foundForm').onsubmit=e=>submitForm(e,'/api/found-persons',r=>{$('#foundResults').innerHTML=`<div class="panel"><h4>Ranked potential matches</h4><p class="small text-muted">A human must confirm the match before any email alert is sent.</p>${r.chart?`<img class="match-chart" src="${r.chart}" alt="Seaborn chart comparing similarity scores by case">`:''}${renderMatchGrid(r.matches, true, r.report_id)}</div>`;toast(r.message)})}
async function verifyFoundReport(reportId, caseId, verified){const locationInput=document.getElementById('verifyLocation-'+caseId);const payload={case_id:caseId,verified};if(verified){payload.location_name=(locationInput&&locationInput.value.trim())||document.querySelector('#foundForm input[name="location_name"]').value.trim();if(!payload.location_name){toast('Please add the verified location before confirming.');return;}}try{const result=await api(`/api/found-persons/${reportId}/verify`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});toast(result.message);if(verified){go('dashboard');}else{const foundPanel=document.querySelector('#foundResults');if(foundPanel)foundPanel.scrollIntoView({behavior:'smooth'});}}catch(e){toast(e.message)}}
async function map(el){let r=await api('/api/maps/events');el.innerHTML=heading('Investigation map','Approximate authorized event locations only.')+`<div class="panel"><div id="mapEvents">${r.events.map(x=>`<div class="result"><i class="fa-solid ${x.type==='sighting'?'fa-eye':'fa-location-dot'}"></i><div><b>${x.case_id}</b><br><small>${x.type.replace('_',' ')} · ${x.location||'Location unavailable'}</small></div><span class="badge-status">${x.status}</span></div>`).join('')||'<div class="empty">No location events available.</div>'}</div></div>`}
async function notifications(el){let r=await api('/api/notifications');el.innerHTML=heading('Notifications','Your case and workflow updates.')+`<div class="panel">${r.items.map(n=>`<div class="result"><i class="fa-solid fa-bell"></i><div><b>${n.title}</b><br><small>${n.message}<br>${new Date(n.created_at).toLocaleString()}</small></div>${!n.is_read?`<button class="btn btn-sm btn-outline-primary" onclick="markRead(${n.id})">Mark read</button>`:''}</div>`).join('')||'<div class="empty">No notifications.</div>'}</div>`}async function markRead(id){await api('/api/notifications/'+id+'/read',{method:'PUT'});go('notifications')}
async function emergency(el){let [contacts, trusted, history]=await Promise.all([api('/api/emergency-contacts'),api('/api/trusted-contacts'),api('/api/emergency/history')]);let admin=me.role==='ADMIN_DEMO';let defaultServices=[{name:'Accident',icon:'fa-car-crash',tone:'accident'},{name:'Fire',icon:'fa-fire-flame-curved',tone:'fire'},{name:'Medical',icon:'fa-kit-medical',tone:'medical'},{name:'Police',icon:'fa-shield-halved',tone:'police'},{name:'Women Safety',icon:'fa-person-dress',tone:'women'},{name:'Child Safety',icon:'fa-child-reaching',tone:'child'}];let serviceCards=defaultServices.map(service=>`<div class="safety-service-card ${service.tone}"><div class="safety-service-icon"><i class="fa-solid ${service.icon}"></i></div><div class="safety-service-label">${service.name}</div></div>`).join('');let primaryContact=contacts.items.find(x=>x.phone && x.phone!=='CONFIGURE')||contacts.items[0];let primaryPhone=primaryContact?primaryContact.phone:'';let serviceButton=primaryPhone?`<a class="btn btn-danger btn-block emergency-call-btn" href="tel:${primaryPhone.replace(/[^+0-9]/g,'')}">Call Emergency Services</a>`:'<button class="btn btn-danger btn-block emergency-call-btn" type="button" disabled>Call Emergency Services</button>';el.innerHTML=heading('Safety Community','Emergency support, quick assistance, and trusted alert access for your area.')+`<div class="safety-community-shell"><div class="safety-community-header"><i class="fa-solid fa-triangle-exclamation"></i> Safety Community</div><div class="safety-grid">${serviceCards}</div><div class="safety-community-footer"><span>Call Emergency Services</span>${serviceButton}</div></div><div class="panel form-panel"><h4><i class="fa-solid fa-triangle-exclamation text-danger"></i> Activate safety alert</h4><p>Use only when you feel unsafe or need immediate assistance. Your trusted contacts receive an email alert with your shared location when email delivery is configured.</p><label>Safety message<textarea id="sosMessage">I activated a safety alert and need assistance.</textarea></label><label>Location name<input id="sosLocation" placeholder="Getting your location…"></label><input id="sosLat" type="hidden"><input id="sosLng" type="hidden"><button id="sosButton" class="btn btn-danger">Send safety alert</button></div><div class="panel form-panel"><h4>Safety community contacts</h4>${contacts.items.map(x=>`<div class="result"><i class="fa-solid fa-phone-volume"></i><div><b>${x.name}</b><br><small>${x.region||''}<br>${x.instructions||''}</small></div>${x.phone==='CONFIGURE'?'<span class="badge-status">Needs configuration</span>':`<a class="btn btn-danger ms-auto" href="tel:${x.phone.replace(/[^+0-9]/g,'')}">Call ${x.phone}</a>`}</div>`).join('')||'<div class="empty">No verified safety contacts configured.</div>'}</div><div class="panel form-panel"><h4>Trusted contacts</h4><div>${trusted.items.map(x=>`<div class="result"><div><b>${x.name}</b><br><small>${x.email||x.phone}</small></div><button class="btn btn-sm btn-outline-danger ms-auto" onclick="removeTrusted(${x.id})">Remove</button></div>`).join('')||'<div class="empty">No trusted contacts yet.</div>'}</div><form id="trustedForm"><label>Name<input name="name" required></label><label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label><button class="btn btn-outline-primary">Add trusted contact</button></form></div><div class="panel form-panel"><h4>Safety alerts history</h4>${history.items.map(x=>`<div class="result"><div><b>Alert #${x.id} · ${x.status}</b><br><small>${x.location_name||'Location unavailable'} · ${new Date(x.created_at).toLocaleString()}</small></div>${x.status==='ACTIVE'?`<button class="btn btn-outline-danger ms-auto" onclick="cancelSOS(${x.id})">Cancel alert</button>`:''}</div>`).join('')||'<div class="empty">No safety alerts yet.</div>'}</div>${admin?`<form id="contactForm" class="panel form-panel"><h4>Configure community contact</h4><label>Name<input name="name" required></label><label>Phone<input name="phone" required></label><label>Region<input name="region" required></label><label>Instructions<textarea name="instructions"></textarea></label><button class="btn btn-primary">Save contact</button></form>`:''}`;if(navigator.geolocation)navigator.geolocation.getCurrentPosition(p=>{$('#sosLat').value=p.coords.latitude;$('#sosLng').value=p.coords.longitude;$('#sosLocation').value=`Current location (${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)})`},()=>{$('#sosLocation').placeholder='Location unavailable; enter a safe description'});$('#sosButton').onclick=async()=>{try{let r=await api('/api/emergency/sos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:$('#sosMessage').value,location_name:$('#sosLocation').value,latitude:$('#sosLat').value||null,longitude:$('#sosLng').value||null})});toast(r.message);emergency(el)}catch(x){toast(x.message)}};$('#trustedForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/trusted-contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast('Trusted contact added.');emergency(el)}catch(x){toast(x.message)}};if(admin)$('#contactForm').onsubmit=e=>{e.preventDefault();api('/api/emergency-contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))}).then(()=>{toast('Safety contact saved.');emergency(el)}).catch(x=>toast(x.message))}}
async function removeTrusted(id){try{await api('/api/trusted-contacts/'+id,{method:'DELETE'});go('emergency')}catch(e){toast(e.message)}}async function cancelSOS(id){try{await api('/api/emergency/sos/'+id+'/cancel',{method:'PUT'});toast('SOS cancelled.');go('emergency')}catch(e){toast(e.message)}}
async function submitForm(e,url,done){e.preventDefault();let b=e.target.querySelector('button[type="submit"],button:last-child');let old=b.textContent;b.disabled=true;b.textContent='Processing…';try{let r=await api(url,{method:'POST',body:new FormData(e.target)});done(r)}catch(x){toast(x.message)}finally{b.disabled=false;b.textContent=old}}
boot();
