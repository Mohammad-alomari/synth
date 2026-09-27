// Start-up (runs last).
// One of the app/ files: build.py joins them in order inside one function scope, so they share their top-level names.
// ---------------- boot ----------------
try { renderAll(); } catch (e) { // a stored program the pages cannot show: start from the first starter program
  console.error('Start-up render failed', e); patch = mossPreset(0); prog = { bank: 'st', idx: 0 }; edited = false; bootNote = 'Your last program could not be shown, so the first starter program is loaded.'; renderAll(); saveCurrent();
}
kbApply(); perfLcd(); showVoices(new Array((patch.voice && patch.voice.maxVoices) || 32).fill(0)); setDockH();
window.addEventListener('resize', setDockH);
if (bootNote) status(bootNote);
restoreImported();
window.__moss = { getPatch: () => patch, engine: () => fallbackEng, perf, kbs, kbApply, setPlayMode, setMidiMode, onMidi, tuningTable, playOn, playOff, pcgBanks, importPcgFile, startAudio, noteOn, noteOff, selectPage, loadProgram };
// installable app: the service worker (sw.js) keeps the page and used sample packs for offline play
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(e => console.warn('Offline support is not available here', e));
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installbtn').hidden = false; });
$('#installbtn').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) { console.debug('install prompt closed', e); } installEvt = null; $('#installbtn').hidden = true; });
window.addEventListener('appinstalled', () => { $('#installbtn').hidden = true; toast('Installed: open Trinity from your home screen'); });
