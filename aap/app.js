
/*
 * ACTIVE ABSORPTION PROGRAM — app.js
 * Static GitHub Pages client. No microphone recording or server-side storage.
 * Daily content: speaking.json, translation.json, followup.json.
 * Local drafts and speaking progress are keyed to the COMPUTER'S LOCAL DATE.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CIRCUMFERENCE = 2 * Math.PI * 87;
  const TASK_NAMES = ['speaking', 'translation', 'followup'];
  const FILES = {
    speaking: 'speaking.json',
    translation: 'translation.json',
    followup: 'followup.json'
  };

  const app = {
    day: localDay(),
    view: 'home',
    config: { speaking: null, translation: null, followup: null },
    speaking: null,
    translation: { text: '', exportedText: null },
    followup: { answers: {}, exportedFingerprint: null },
    storageOK: true,
    loadGeneration: 0,
    toastTimer: null,
    renderedQuestionKey: null
  };

  function localDay(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function fileDate() {
    const [y, m, d] = app.day.split('-');
    return `${d}-${m}-${y}`;
  }

  function storageKey(task) {
    return `aap_${app.day}_${task}`;
  }

  function setSaveStatus(message) {
    $('globalSaveStatus').textContent = message;
    document.querySelector('.storage-pill')?.classList.toggle('storage-warning', !app.storageOK);
  }

  function readSaved(task) {
    try {
      const content = localStorage.getItem(storageKey(task));
      return content === null ? null : JSON.parse(content);
    } catch (error) {
      if (error instanceof DOMException) {
        app.storageOK = false;
        setSaveStatus('Local saving unavailable — download your work');
      }
      return null;
    }
  }

  function save(task, value) {
    try {
      localStorage.setItem(storageKey(task), JSON.stringify(value));
      app.storageOK = true;
      setSaveStatus('Stored on this device');
      return true;
    } catch (_error) {
      app.storageOK = false;
      setSaveStatus('Local saving unavailable — download your work');
      return false;
    }
  }

  function restoreDailyWork() {
    const speaking = readSaved('speaking');
    app.speaking = validSavedSession(speaking) ? speaking : null;

    const translation = readSaved('translation');
    app.translation = {
      text: typeof translation?.text === 'string' ? translation.text : '',
      exportedText: typeof translation?.exportedText === 'string' ? translation.exportedText : null
    };

    const followup = readSaved('followup');
    const answers = {};
    if (followup?.answers && typeof followup.answers === 'object' && !Array.isArray(followup.answers)) {
      for (const [id, answer] of Object.entries(followup.answers)) {
        if (typeof answer === 'string') answers[id] = answer;
      }
    }
    app.followup = {
      answers,
      exportedFingerprint: typeof followup?.exportedFingerprint === 'string'
        ? followup.exportedFingerprint : null
    };
  }

  function validSavedSession(session) {
    return Boolean(session && typeof session === 'object'
      && ['active', 'complete'].includes(session.mode)
      && Array.isArray(session.questions) && session.questions.length > 0
      && session.questions.every(validSpeakingQuestion)
      && Number.isInteger(session.index) && session.index >= 0 && session.index < session.questions.length
      && ['reading', 'speaking', 'ready'].includes(session.phase)
      && Number.isFinite(session.phaseStart) && session.phaseStart > 0);
  }

  function validSpeakingQuestion(q) {
    return Boolean(q && (typeof q.id === 'number' || typeof q.id === 'string')
      && String(q.id).length > 0 && typeof q.question === 'string' && q.question.trim()
      && Number.isInteger(q.reading_seconds) && q.reading_seconds > 0 && q.reading_seconds <= 3600
      && Number.isInteger(q.speaking_seconds) && q.speaking_seconds > 0 && q.speaking_seconds <= 7200);
  }

  function validateDailyData(task, data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Expected a JSON object');
    }
    if (data.date !== app.day) {
      throw new Error(`Date must be ${app.day} (file says ${String(data.date ?? 'missing')})`);
    }

    if (task === 'speaking') {
      if (!Array.isArray(data.questions) || data.questions.length === 0
          || !data.questions.every(validSpeakingQuestion)) {
        throw new Error('Questions require id, question, reading_seconds and speaking_seconds');
      }
      ensureUniqueIDs(data.questions);
      return { date: data.date, questions: data.questions.map((q) => ({
        id: q.id,
        question: q.question.trim(),
        reading_seconds: q.reading_seconds,
        speaking_seconds: q.speaking_seconds
      })) };
    }

    if (task === 'translation') {
      if (typeof data.essay !== 'string' || !data.essay.trim()
          || !Array.isArray(data.required_words)
          || !data.required_words.every((word) => typeof word === 'string' && word.trim())) {
        throw new Error('Expected essay (text) and required_words (list of French words)');
      }
      return {
        date: data.date,
        title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'English source',
        essay: data.essay,
        required_words: data.required_words.map((word) => word.trim())
      };
    }

    if (task === 'followup') {
      if (!Array.isArray(data.questions) || data.questions.length === 0
          || !data.questions.every((q) => q && (typeof q.id === 'number' || typeof q.id === 'string')
            && String(q.id).length > 0 && typeof q.question === 'string' && q.question.trim())) {
        throw new Error('Questions require id and question text');
      }
      ensureUniqueIDs(data.questions);
      return {
        date: data.date,
        title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'Today’s reflection',
        questions: data.questions.map((q) => ({ id: q.id, question: q.question.trim() }))
      };
    }
    throw new Error('Unknown task');
  }

  function ensureUniqueIDs(questions) {
    const ids = questions.map((q) => String(q.id));
    if (new Set(ids).size !== ids.length) throw new Error('Every question id must be unique');
  }

  async function fetchTask(task) {
    const name = FILES[task];
    const url = new URL(name, document.baseURI);
    // A fresh query string also avoids old GitHub Pages/CDN responses after daily updates.
    url.searchParams.set('day', app.day);
    url.searchParams.set('refresh', String(Date.now()));
    let response;
    try {
      response = await fetch(url.toString(), { cache: 'no-store' });
    } catch (_error) {
      throw new Error('Network unavailable (open this site over HTTPS, not file://)');
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} — file not available`);
    let data;
    try {
      data = await response.json();
    } catch (_error) {
      throw new Error('Invalid JSON syntax');
    }
    return validateDailyData(task, data);
  }

  async function loadDailyFiles() {
    const generation = ++app.loadGeneration;
    const dayAtLoad = app.day;
    $('loadError').hidden = true;
    $('retryLoadButton').disabled = true;
    const outcomes = await Promise.all(TASK_NAMES.map(async (task) => {
      try {
        return { task, value: await fetchTask(task) };
      } catch (error) {
        return { task, error: `${FILES[task]}: ${error.message}` };
      }
    }));
    if (generation !== app.loadGeneration || dayAtLoad !== app.day) return;

    const problems = [];
    for (const outcome of outcomes) {
      app.config[outcome.task] = outcome.value || null;
      if (outcome.error && !(outcome.task === 'speaking' && app.speaking)) {
        problems.push(outcome.error);
      }
    }
    if (problems.length) {
      $('loadErrorText').textContent = `Cannot load today's content. ${problems.join(' · ')}`;
      $('loadError').hidden = false;
    } else {
      $('loadError').hidden = true;
    }
    $('retryLoadButton').disabled = false;
    renderLoadedContent();
  }

  function renderLoadedContent() {
    renderTranslation();
    renderFollowups();
    renderSpeaking();
    updateHome();
  }

  function formatCount(value) {
    return `${value} WORD${value === 1 ? '' : 'S'}`;
  }

  function wordCount(value) {
    const clean = String(value).trim();
    return clean ? clean.split(/\s+/u).length : 0;
  }

  function showView(name) {
    if (!['home', ...TASK_NAMES].includes(name)) return;
    if (name !== 'home' && !taskAvailable(name)) {
      showToast(`Today's ${name} exercise is not available. Check its JSON file.`);
      return;
    }
    if (app.view === 'speaking' && name !== 'speaking') stopSpeech();
    app.view = name;
    $('viewHome').hidden = name !== 'home';
    $('viewSpeaking').hidden = name !== 'speaking';
    $('viewTranslation').hidden = name !== 'translation';
    $('viewFollowup').hidden = name !== 'followup';
    if (name === 'speaking') renderSpeaking();
    if (name === 'home') updateHome();
    window.scrollTo(0, 0);
  }

  function taskAvailable(name) {
    return Boolean(app.config[name] || (name === 'speaking' && app.speaking));
  }

  function translationComplete() {
    return Boolean(app.translation.text.trim() && app.translation.exportedText === app.translation.text);
  }

  function followupFingerprint() {
    const questions = app.config.followup?.questions || [];
    return JSON.stringify(questions.map((q) => [String(q.id), app.followup.answers[String(q.id)] || '']));
  }

  function allFollowupsAnswered() {
    const questions = app.config.followup?.questions || [];
    return Boolean(questions.length && questions.every((q) =>
      (app.followup.answers[String(q.id)] || '').trim()));
  }

  function followupComplete() {
    return allFollowupsAnswered()
      && app.followup.exportedFingerprint === followupFingerprint();
  }

  function updateHome() {
    const statuses = {
      speaking: app.speaking?.mode === 'complete' ? 'Completed'
        : app.speaking ? 'In progress' : 'Not started',
      translation: translationComplete() ? 'Completed'
        : app.translation.text.trim() ? 'In progress' : 'Not started',
      followup: followupComplete() ? 'Completed'
        : Object.values(app.followup.answers).some((answer) => answer.trim()) ? 'In progress' : 'Not started'
    };
    let completed = 0;
    for (const task of TASK_NAMES) {
      const available = taskAvailable(task);
      const node = $(`home${task[0].toUpperCase()}${task.slice(1)}Status`);
      node.textContent = !available && !app.speaking && task === 'speaking' ? 'Unavailable'
        : !available ? 'Unavailable' : statuses[task];
      const card = document.querySelector(`[data-open-task="${task}"]`);
      if (card) {
        card.disabled = !available;
        card.setAttribute('aria-disabled', String(!available));
        card.title = available ? '' : `The ${FILES[task]} file is missing or out of date`;
      }
      if (available && statuses[task] === 'Completed') completed++;
    }
    $('homeCompletedCount').textContent = `${completed} of 3 tasks completed`;
  }

  // -----------------------------------------------------------------------
  // TASK 1 — Speaking. Only the CURRENT question is ever inserted in the UI.
  // A question progresses reading -> speaking -> ready-to-advance, based on
  // absolute timestamps so refresh/closed tabs never restart the clock.
  // -----------------------------------------------------------------------
  function speakingQuestions() {
    return app.speaking?.questions || app.config.speaking?.questions || [];
  }

  function currentSpeakingQuestion() {
    return app.speaking?.questions[app.speaking.index] || null;
  }

  function beginSession() {
    if (app.speaking) return; // No restarting or replaying previous prompts.
    const questions = app.config.speaking?.questions;
    if (!questions?.length) return;
    app.speaking = {
      mode: 'active',
      questions: questions.map((q) => ({ ...q })),
      index: 0,
      phase: 'reading',
      phaseStart: Date.now()
    };
    app.renderedQuestionKey = null;
    save('speaking', app.speaking);
    renderSpeaking();
    updateHome();
  }

  function synchronizeSpeakingClock() {
    const session = app.speaking;
    if (!session || session.mode !== 'active') return false;
    const question = currentSpeakingQuestion();
    if (!question) return false;
    const now = Date.now();
    let changed = false;

    if (session.phase === 'reading' && now >= session.phaseStart + question.reading_seconds * 1000) {
      session.phaseStart += question.reading_seconds * 1000;
      session.phase = 'speaking';
      changed = true;
    }
    if (session.phase === 'speaking' && now >= session.phaseStart + question.speaking_seconds * 1000) {
      session.phaseStart += question.speaking_seconds * 1000;
      session.phase = 'ready';
      changed = true;
    }
    if (changed) save('speaking', session);
    return changed;
  }

  function timeRemaining() {
    const session = app.speaking;
    const q = currentSpeakingQuestion();
    if (!session || !q || session.phase === 'ready') return { seconds: 0, fraction: 0 };
    const duration = (session.phase === 'reading' ? q.reading_seconds : q.speaking_seconds) * 1000;
    const remainingMs = Math.max(0, duration - (Date.now() - session.phaseStart));
    return {
      seconds: Math.ceil(remainingMs / 1000),
      fraction: Math.max(0, Math.min(1, remainingMs / duration))
    };
  }

  function formatTimer(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, '0');
    if (minutes >= 60) {
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:${remainder}`;
    }
    return `${String(minutes).padStart(2, '0')}:${remainder}`;
  }

  function renderSpeaking() {
    const questions = speakingQuestions();
    $('speakingIntroCount').textContent = String(questions.length || '—');
    const session = app.speaking;
    $('speakingIntro').hidden = Boolean(session);
    $('speakingLive').hidden = !session || session.mode !== 'active';
    $('speakingComplete').hidden = !session || session.mode !== 'complete';
    if (!session || session.mode !== 'active') return;

    synchronizeSpeakingClock();
    const question = currentSpeakingQuestion();
    if (!question) return;
    const key = `${app.day}:${session.index}`;
    if (app.renderedQuestionKey !== key) {
      // Do NOT render, log, or include any later questions in the DOM.
      $('speakingQuestionText').textContent = question.question;
      $('speakingQuestionNumber').textContent = String(session.index + 1);
      $('speakingQuestionTotal').textContent = String(session.questions.length);
      $('speakingVoiceStatus').textContent = 'Select the speaker icon to hear the question.';
      const bars = $('speakingProgressSegments');
      bars.replaceChildren();
      for (let i = 0; i < session.questions.length; i++) {
        const bar = document.createElement('span');
        if (i < session.index) bar.className = 'complete';
        else if (i === session.index) bar.className = 'active';
        bars.appendChild(bar);
      }
      app.renderedQuestionKey = key;
    }
    renderSpeakingTimer();
  }

  function renderSpeakingTimer() {
    const session = app.speaking;
    if (!session || session.mode !== 'active') return;
    const changed = synchronizeSpeakingClock();
    const phase = session.phase;
    const remaining = timeRemaining();
    $('speakingTimer').textContent = formatTimer(remaining.seconds);
    $('speakingTimerRing').style.strokeDasharray = String(CIRCUMFERENCE);
    $('speakingTimerRing').style.strokeDashoffset = String(CIRCUMFERENCE * (1 - remaining.fraction));
    const live = $('speakingLive');
    if (live.dataset.phase !== phase || changed) {
      live.dataset.phase = phase;
      const label = $('speakingPhaseLabel');
      label.dataset.phase = phase;
      label.textContent = phase === 'reading' ? 'READING TIME'
        : phase === 'speaking' ? 'SPEAKING TIME' : 'TIME COMPLETE';
      $('speakingTimerCaption').textContent = phase === 'reading' ? 'TIME TO READ'
        : phase === 'speaking' ? 'TIME TO SPEAK' : 'TIME COMPLETE';
      $('speakingInstructions').textContent = phase === 'reading'
        ? 'Read the question and plan your answer. Speaking begins automatically.'
        : phase === 'speaking'
          ? 'Speak your answer aloud now. Your phone recorder captures the session.'
          : 'Speaking time is over. Advance when you are ready.';
      const ready = phase === 'ready';
      const last = session.index === session.questions.length - 1;
      $('speakingAdvanceHint').hidden = ready;
      $('nextSpeakingQuestion').hidden = !ready || last;
      $('finishSpeakingSession').hidden = !ready || !last;
    }
  }

  function advanceSpeaking() {
    const session = app.speaking;
    if (!session || session.mode !== 'active') return;
    synchronizeSpeakingClock();
    if (session.phase !== 'ready' || session.index >= session.questions.length - 1) return;
    stopSpeech();
    session.index++;
    session.phase = 'reading';
    session.phaseStart = Date.now();
    app.renderedQuestionKey = null;
    save('speaking', session);
    renderSpeaking();
    updateHome();
    window.scrollTo(0, 0);
  }

  function finishSpeaking() {
    const session = app.speaking;
    if (!session || session.mode !== 'active') return;
    synchronizeSpeakingClock();
    if (session.phase !== 'ready' || session.index !== session.questions.length - 1) return;
    stopSpeech();
    session.mode = 'complete';
    save('speaking', session);
    renderSpeaking();
    updateHome();
    showToast('Speaking session finished. Analyze your phone recording with AI.');
  }

  function stopSpeech() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  function sayCurrentQuestion() {
    const question = currentSpeakingQuestion();
    if (!question || !app.speaking || app.speaking.mode !== 'active') return;
    const status = $('speakingVoiceStatus');
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      status.textContent = 'Voice playback is not supported by this browser.';
      showToast('French text-to-speech is unavailable in this browser.');
      return;
    }
    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(question.question);
    utterance.lang = 'fr-CA';
    utterance.rate = 0.92;
    utterance.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((v) => v.lang.toLowerCase().replace('_', '-') === 'fr-ca')
      || voices.find((v) => v.lang.toLowerCase().replace('_', '-') === 'fr-fr')
      || voices.find((v) => v.lang.toLowerCase().startsWith('fr'));
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    const indexAtStart = app.speaking.index;
    status.textContent = voice ? 'Playing French pronunciation…' : 'Trying French playback with available system voices…';
    utterance.onend = () => {
      if (app.speaking?.index === indexAtStart) {
        status.textContent = 'Select the speaker icon to listen again.';
      }
    };
    utterance.onerror = (event) => {
      if (event.error !== 'canceled' && app.speaking?.index === indexAtStart) {
        status.textContent = 'Audio could not play. Check your browser’s French voices.';
      }
    };
    try {
      window.speechSynthesis.speak(utterance);
    } catch (_error) {
      status.textContent = 'Audio could not play. Try another browser or install a French voice.';
    }
  }

  // -----------------------------------------------------------------------
  // TASK 2 — Translation, immediate local save and export.
  // -----------------------------------------------------------------------
  function renderTranslation() {
    const config = app.config.translation;
    $('sourceHeading').textContent = config?.title || 'English source';
    $('englishEssay').textContent = config?.essay || 'Today’s passage is unavailable.';
    $('englishWordCount').textContent = config ? formatCount(wordCount(config.essay)) : '— WORDS';
    const words = $('requiredWords');
    words.replaceChildren();
    for (const word of config?.required_words || []) {
      const li = document.createElement('li');
      li.textContent = word;
      words.appendChild(li);
    }
    $('frenchTranslation').value = app.translation.text;
    updateTranslationInfo();
  }

  function updateTranslationInfo() {
    $('translationWordCount').textContent = formatCount(wordCount(app.translation.text));
    $('translationSaveStatus').textContent = !app.storageOK ? 'NOT SAVED — DOWNLOAD YOUR WORK'
      : translationComplete() ? 'DOWNLOADED'
        : app.translation.text.trim() ? 'SAVED LOCALLY' : 'READY TO WRITE';
    updateHome();
  }

  function onTranslationInput() {
    if (checkForNewDay()) return;
    app.translation.text = $('frenchTranslation').value;
    save('translation', app.translation);
    updateTranslationInfo();
  }

  function triggerTextDownload(filename, body) {
    try {
      const blob = new Blob(['\ufeff', body], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      return true;
    } catch (_error) {
      showToast('Could not create the download. Try a different browser.');
      return false;
    }
  }

  function downloadTranslation() {
    if (checkForNewDay()) return;
    const text = app.translation.text;
    if (!text.trim()) {
      showToast('Write your French translation before downloading.');
      $('frenchTranslation').focus();
      return;
    }
    if (!triggerTextDownload(`${fileDate()}-essay.txt`, text)) return;
    app.translation.exportedText = text;
    save('translation', app.translation);
    updateTranslationInfo();
    showToast('Translation download requested. Keep a copy of your file.');
  }

  // -----------------------------------------------------------------------
  // TASK 3 — Follow-up fields are created safely with the HTML template.
  // Answers are indexed by stable JSON question ids, not their positions.
  // -----------------------------------------------------------------------
  function renderFollowups() {
    const config = app.config.followup;
    $('followupTitle').textContent = config?.title || 'Today’s reflection';
    const list = $('followupQuestions');
    list.replaceChildren();
    if (config) {
      const template = $('followupQuestionTemplate');
      for (const [i, question] of config.questions.entries()) {
        const node = template.content.firstElementChild.cloneNode(true);
        const answer = node.querySelector('[data-followup-answer]');
        const id = `followup-answer-${i}`;
        answer.id = id;
        answer.dataset.questionId = String(question.id);
        answer.value = app.followup.answers[String(question.id)] || '';
        const label = node.querySelector('[data-question-label]');
        label.htmlFor = id;
        label.textContent = question.question;
        node.querySelector('[data-question-number]').textContent = String(i + 1).padStart(2, '0');
        answer.addEventListener('input', onFollowupInput);
        refreshFollowupItem(node, answer.value);
        list.appendChild(node);
      }
    }
    updateFollowupInfo();
  }

  function refreshFollowupItem(node, value) {
    const hasAnswer = Boolean(value.trim());
    node.classList.toggle('is-answered', hasAnswer);
    node.querySelector('[data-question-check]').setAttribute('aria-label',
      hasAnswer ? 'Question answered' : 'Question not answered');
    node.querySelector('[data-question-words]').textContent = `${wordCount(value)} words`;
    node.querySelector('[data-question-save]').textContent = app.storageOK
      ? 'Saved automatically' : 'Not saved — download your answers';
  }

  function updateFollowupInfo() {
    const questions = app.config.followup?.questions || [];
    const answered = questions.filter((q) => (app.followup.answers[String(q.id)] || '').trim()).length;
    $('followupAnsweredCount').textContent = `${answered} / ${questions.length}`;
    updateHome();
  }

  function onFollowupInput(event) {
    if (checkForNewDay()) return;
    const textarea = event.currentTarget;
    app.followup.answers[textarea.dataset.questionId] = textarea.value;
    save('followup', app.followup);
    refreshFollowupItem(textarea.closest('[data-followup-item]'), textarea.value);
    updateFollowupInfo();
  }

  function downloadFollowup() {
    if (checkForNewDay()) return;
    const config = app.config.followup;
    if (!config) return;
    const anyAnswered = config.questions.some((q) =>
      (app.followup.answers[String(q.id)] || '').trim());
    if (!anyAnswered) {
      showToast('Write at least one answer before downloading.');
      return;
    }
    const lines = [
      'ACTIVE ABSORPTION — FOLLOW-UP QUESTIONS',
      config.title,
      `Date: ${app.day}`,
      '',
      ...config.questions.flatMap((q, i) => [
        `Question ${i + 1}: ${q.question}`,
        `Answer: ${app.followup.answers[String(q.id)] || '(not answered)'}`,
        ''
      ])
    ];
    if (!triggerTextDownload(`${fileDate()}-followup.txt`, lines.join('\n'))) return;
    app.followup.exportedFingerprint = followupFingerprint();
    save('followup', app.followup);
    updateFollowupInfo();
    showToast(allFollowupsAnswered()
      ? 'Follow-up download requested. All questions answered.'
      : 'Partial answers download requested. You can continue writing.');
  }

  // -----------------------------------------------------------------------
  // Daily boundary: a new LOCAL calendar day gets clean inputs and content.
  // Yesterday's storage keys are left intact for safety and later recovery.
  // -----------------------------------------------------------------------
  function updateDateLabel() {
    const now = new Date();
    $('currentDate').dateTime = app.day;
    $('currentDate').textContent = new Intl.DateTimeFormat('en-CA', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    }).format(now);
  }

  function checkForNewDay() {
    const day = localDay();
    if (day === app.day) return false;
    stopSpeech();
    app.loadGeneration++; // Invalidates responses requested for the old day.
    app.day = day;
    app.config = { speaking: null, translation: null, followup: null };
    app.renderedQuestionKey = null;
    restoreDailyWork();
    updateDateLabel();
    $('frenchTranslation').value = app.translation.text;
    showView('home');
    updateHome();
    loadDailyFiles();
    showToast('A new day has started. Your previous work is still stored under yesterday’s date.');
    return true;
  }

  function showToast(message) {
    const toast = $('toast');
    $('toastMessage').textContent = message;
    toast.hidden = false;
    window.clearTimeout(app.toastTimer);
    app.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4200);
  }

  function bindEvents() {
    document.querySelectorAll('[data-open-task]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!checkForNewDay()) showView(button.dataset.openTask);
      });
    });
    document.querySelectorAll('[data-go-home]').forEach((button) => {
      button.addEventListener('click', () => showView('home'));
    });
    $('retryLoadButton').addEventListener('click', loadDailyFiles);
    $('beginSpeakingSession').addEventListener('click', beginSession);
    $('nextSpeakingQuestion').addEventListener('click', advanceSpeaking);
    $('finishSpeakingSession').addEventListener('click', finishSpeaking);
    $('playSpeakingQuestion').addEventListener('click', sayCurrentQuestion);
    $('frenchTranslation').addEventListener('input', onTranslationInput);
    $('downloadTranslation').addEventListener('click', downloadTranslation);
    $('downloadFollowup').addEventListener('click', downloadFollowup);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !checkForNewDay()) renderSpeakingTimer();
    });
    window.addEventListener('pageshow', () => {
      if (!checkForNewDay()) renderSpeakingTimer();
    });
  }

  function init() {
    restoreDailyWork();
    updateDateLabel();
    bindEvents();
    showView('home');
    updateHome();
    loadDailyFiles();
    // Absolute clock times provide accurate resumption even if interval is throttled.
    window.setInterval(() => {
      if (checkForNewDay()) return;
      if (app.speaking?.mode === 'active') {
        const phaseChanged = synchronizeSpeakingClock();
        if (phaseChanged || app.view === 'speaking') renderSpeakingTimer();
      }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
