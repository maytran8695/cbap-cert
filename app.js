(() => {
  "use strict";

  const SET_FILES = { set1: "data/set1.json", set2: "data/set2.json", set3: "data/set3.json" };
  const SET_LABELS = { set1: "Standard", set2: "Advanced Set 2", set3: "Expert" };
  const SECONDS_PER_QUESTION = 90; // 1.5 min, matches real CBAP pace

  const LS_BOOKMARKS = "cbap_bookmarks";
  const LS_WRONG = "cbap_wrong";

  /** @type {Record<string, any>} raw datasets keyed by examId */
  const DATA = {};
  /** @type {Record<string, any>} all questions keyed by uid ("set1-Q45") */
  const QUESTIONS_BY_UID = {};

  let session = null; // current quiz session state
  let timerInterval = null;

  // ---------- storage helpers ----------
  function loadSet(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); }
    catch { return new Set(); }
  }
  function saveSet(key, set) {
    localStorage.setItem(key, JSON.stringify([...set]));
  }

  function uid(examId, id) { return `${examId}-Q${id}`; }

  // ---------- data loading ----------
  async function loadData() {
    const entries = await Promise.all(
      Object.entries(SET_FILES).map(async ([examId, path]) => {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`Failed to load ${path}`);
        return [examId, await res.json()];
      })
    );
    for (const [examId, data] of entries) {
      DATA[examId] = data;
      for (const q of data.questions) {
        const u = uid(examId, q.id);
        QUESTIONS_BY_UID[u] = { ...q, uid: u, examId, sourceLabel: SET_LABELS[examId] };
      }
      const countEl = document.getElementById(`count-${examId}`);
      if (countEl) countEl.textContent = `(${data.questions.length} câu)`;
    }
  }

  // ---------- home screen ----------
  function updateReviewButton() {
    const bookmarks = loadSet(LS_BOOKMARKS);
    const wrong = loadSet(LS_WRONG);
    const union = new Set([...bookmarks, ...wrong]);
    const btn = document.getElementById("btn-review");
    const countEl = document.getElementById("review-count");
    countEl.textContent = String(union.size);
    btn.disabled = union.size === 0;
  }

  function getSelectedKAs() {
    return [...document.querySelectorAll("#ka-select input:checked")].map(i => i.value);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function buildQuestionList(source, kaFilter) {
    let list;
    if (source === "mixed") {
      list = Object.values(QUESTIONS_BY_UID);
      list = shuffle(list);
    } else {
      list = DATA[source].questions.map(q => QUESTIONS_BY_UID[uid(source, q.id)]);
    }
    return list.filter(q => kaFilter.includes(q.ka));
  }

  function startSession(questions, mode, isReview) {
    if (questions.length === 0) {
      alert("Không có câu hỏi nào khớp với bộ lọc đã chọn.");
      return;
    }
    session = {
      mode,
      isReview: !!isReview,
      questions,
      index: 0,
      answers: {},        // uid -> selected letter
      bookmarked: new Set(loadSet(LS_BOOKMARKS)),
      timeLimit: mode === "exam" ? questions.length * SECONDS_PER_QUESTION : null,
      startedAt: Date.now(),
    };
    showScreen("quiz");
    renderQuestion();
    if (mode === "exam") startTimer();
  }

  // ---------- quiz screen ----------
  function showScreen(name) {
    for (const s of ["home", "quiz", "result"]) {
      document.getElementById(`screen-${s}`).classList.toggle("hidden", s !== name);
    }
  }

  function currentQuestion() {
    return session.questions[session.index];
  }

  function renderQuestion() {
    const q = currentQuestion();
    const total = session.questions.length;

    document.getElementById("quiz-position").textContent = `Câu ${session.index + 1} / ${total}`;
    document.getElementById("progress-fill").style.width = `${((session.index + 1) / total) * 100}%`;

    const kaTag = document.getElementById("question-ka");
    kaTag.textContent = `${q.ka}${q.sourceLabel && session.questions.some(x => x.examId !== q.examId) ? " · " + q.sourceLabel : ""}`;

    const bookmarkBtn = document.getElementById("btn-bookmark");
    bookmarkBtn.classList.toggle("active", session.bookmarked.has(q.uid));
    bookmarkBtn.textContent = session.bookmarked.has(q.uid) ? "★" : "☆";

    document.getElementById("question-text").textContent = q.question;

    const optionsList = document.getElementById("options-list");
    optionsList.innerHTML = "";
    const selected = session.answers[q.uid];
    const showFeedback = session.mode === "practice" && selected !== undefined;

    for (const letter of ["A", "B", "C", "D"]) {
      const btn = document.createElement("button");
      btn.className = "option-btn";
      btn.disabled = showFeedback;
      if (showFeedback) {
        if (letter === q.correct) btn.classList.add("correct");
        else if (letter === selected) btn.classList.add("incorrect");
      } else if (letter === selected) {
        btn.classList.add("selected");
      }
      btn.innerHTML = `<span class="opt-letter">${letter}.</span><span>${escapeHtml(q.options[letter])}</span>`;
      btn.addEventListener("click", () => selectAnswer(letter));
      optionsList.appendChild(btn);
    }

    const explBox = document.getElementById("explanation-box");
    if (showFeedback) {
      explBox.classList.remove("hidden");
      const correct = selected === q.correct;
      explBox.innerHTML = `<span class="expl-label">${correct ? "✓ Chính xác" : `✗ Sai — đáp án đúng là ${q.correct}`}</span>${escapeHtml(q.explanation)}`;
    } else {
      explBox.classList.add("hidden");
      explBox.innerHTML = "";
    }

    document.getElementById("btn-prev").disabled = session.index === 0;
    const isLast = session.index === total - 1;
    const nextBtn = document.getElementById("btn-next");
    const submitBtn = document.getElementById("btn-submit");
    if (session.mode === "practice") {
      nextBtn.textContent = isLast ? "Xem kết quả" : "Câu tiếp →";
      nextBtn.classList.remove("hidden");
      submitBtn.classList.add("hidden");
      nextBtn.disabled = !showFeedback;
    } else {
      nextBtn.classList.toggle("hidden", isLast);
      nextBtn.textContent = "Câu tiếp →";
      submitBtn.classList.remove("hidden");
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function selectAnswer(letter) {
    const q = currentQuestion();
    if (session.mode === "practice" && session.answers[q.uid] !== undefined) return; // already locked
    session.answers[q.uid] = letter;
    renderQuestion();
  }

  function toggleBookmark() {
    const q = currentQuestion();
    if (session.bookmarked.has(q.uid)) session.bookmarked.delete(q.uid);
    else session.bookmarked.add(q.uid);
    saveSet(LS_BOOKMARKS, session.bookmarked);
    renderQuestion();
  }

  function goPrev() {
    if (session.index > 0) { session.index--; renderQuestion(); }
  }
  function goNext() {
    if (session.index < session.questions.length - 1) { session.index++; renderQuestion(); }
    else if (session.mode === "practice") finishSession();
  }

  function startTimer() {
    let remaining = session.timeLimit;
    const timerEl = document.getElementById("quiz-timer");
    timerEl.classList.remove("hidden");
    const render = () => {
      const h = String(Math.floor(remaining / 3600)).padStart(2, "0");
      const m = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
      const s = String(remaining % 60).padStart(2, "0");
      timerEl.textContent = `${h}:${m}:${s}`;
      timerEl.classList.toggle("low-time", remaining <= 300);
    };
    render();
    timerInterval = setInterval(() => {
      remaining--;
      render();
      if (remaining <= 0) {
        clearInterval(timerInterval);
        finishSession();
      }
    }, 1000);
  }
  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    document.getElementById("quiz-timer").classList.add("hidden");
  }

  function exitQuiz() {
    if (!confirm("Thoát bài làm hiện tại? Tiến trình sẽ không được lưu.")) return;
    stopTimer();
    session = null;
    showScreen("home");
    updateReviewButton();
  }

  // ---------- result screen ----------
  function finishSession() {
    stopTimer();

    const wrongSet = loadSet(LS_WRONG);
    const results = session.questions.map(q => {
      const chosen = session.answers[q.uid];
      const isCorrect = chosen === q.correct;
      if (isCorrect) wrongSet.delete(q.uid);
      else wrongSet.add(q.uid);
      return { ...q, chosen, isCorrect };
    });
    saveSet(LS_WRONG, wrongSet);
    saveSet(LS_BOOKMARKS, session.bookmarked);

    renderResult(results);
    session.lastResults = results;
    showScreen("result");
    updateReviewButton();
  }

  function renderResult(results) {
    const total = results.length;
    const correctCount = results.filter(r => r.isCorrect).length;
    document.getElementById("score-big").textContent = `${correctCount}/${total}`;
    document.getElementById("score-pct").textContent = `${Math.round((correctCount / total) * 100)}%`;

    const kaStats = {};
    for (const r of results) {
      kaStats[r.ka] ??= { total: 0, correct: 0 };
      kaStats[r.ka].total++;
      if (r.isCorrect) kaStats[r.ka].correct++;
    }
    const kaTable = document.getElementById("ka-table");
    const rows = Object.entries(kaStats)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ka, s]) => `<tr><td>${ka}</td><td>${s.correct}/${s.total}</td><td>${Math.round((s.correct / s.total) * 100)}%</td></tr>`)
      .join("");
    kaTable.innerHTML = `<tr><th>KA</th><th>Đúng</th><th>%</th></tr>${rows}`;

    renderReviewList(results);
    document.getElementById("filter-wrong-only").checked = false;
  }

  function renderReviewList(results) {
    const container = document.getElementById("review-list");
    const wrongOnly = document.getElementById("filter-wrong-only").checked;
    const items = wrongOnly ? results.filter(r => !r.isCorrect) : results;
    container.innerHTML = items.map((r, i) => {
      const chosenText = r.chosen ? `${r.chosen}. ${escapeHtml(r.options[r.chosen])}` : "(chưa trả lời)";
      const correctText = `${r.correct}. ${escapeHtml(r.options[r.correct])}`;
      return `
        <div class="review-item ${r.isCorrect ? "correct" : "wrong"}">
          <div class="rq-head"><span>${r.ka} · ${r.sourceLabel}</span><span>${r.isCorrect ? "✓ Đúng" : "✗ Sai"}</span></div>
          <p class="rq-text">${escapeHtml(r.question)}</p>
          <div class="rq-answer ${r.isCorrect ? "" : "wrong-ans"}">Bạn chọn: ${chosenText}</div>
          ${!r.isCorrect ? `<div class="rq-answer correct-ans">Đáp án đúng: ${correctText}</div>` : ""}
          <div class="rq-expl">${escapeHtml(r.explanation)}</div>
        </div>`;
    }).join("");
  }

  // ---------- wiring ----------
  function wireEvents() {
    document.getElementById("ka-select-all").addEventListener("click", () => {
      document.querySelectorAll("#ka-select input").forEach(i => i.checked = true);
    });
    document.getElementById("ka-select-none").addEventListener("click", () => {
      document.querySelectorAll("#ka-select input").forEach(i => i.checked = false);
    });

    document.getElementById("btn-start").addEventListener("click", () => {
      const source = document.querySelector('input[name="source"]:checked').value;
      const mode = document.querySelector('input[name="mode"]:checked').value;
      const kaFilter = getSelectedKAs();
      if (kaFilter.length === 0) { alert("Vui lòng chọn ít nhất một Knowledge Area."); return; }
      const questions = buildQuestionList(source, kaFilter);
      startSession(questions, mode, false);
    });

    document.getElementById("btn-review").addEventListener("click", () => {
      const bookmarks = loadSet(LS_BOOKMARKS);
      const wrong = loadSet(LS_WRONG);
      const uids = [...new Set([...bookmarks, ...wrong])];
      const questions = shuffle(uids.map(u => QUESTIONS_BY_UID[u]).filter(Boolean));
      startSession(questions, "practice", true);
    });

    document.getElementById("btn-bookmark").addEventListener("click", toggleBookmark);
    document.getElementById("btn-prev").addEventListener("click", goPrev);
    document.getElementById("btn-next").addEventListener("click", goNext);
    document.getElementById("btn-submit").addEventListener("click", () => {
      if (confirm("Nộp bài ngay bây giờ?")) finishSession();
    });
    document.getElementById("btn-exit-quiz").addEventListener("click", exitQuiz);

    document.getElementById("btn-back-home").addEventListener("click", () => {
      session = null;
      showScreen("home");
      updateReviewButton();
    });
    document.getElementById("btn-review-wrong-now").addEventListener("click", () => {
      const wrongQuestions = session.lastResults.filter(r => !r.isCorrect).map(r => QUESTIONS_BY_UID[r.uid]);
      if (wrongQuestions.length === 0) { alert("Không có câu sai nào trong lần làm này!"); return; }
      startSession(shuffle(wrongQuestions), "practice", true);
    });
    document.getElementById("filter-wrong-only").addEventListener("change", () => {
      renderReviewList(session.lastResults);
    });
  }

  async function init() {
    wireEvents();
    updateReviewButton();
    try {
      await loadData();
    } catch (err) {
      alert("Không thể tải dữ liệu đề thi. Nếu bạn đang mở file trực tiếp (file://), hãy chạy một local server, ví dụ: python3 -m http.server");
      console.error(err);
    }
  }

  init();
})();
