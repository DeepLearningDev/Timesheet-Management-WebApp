"use client";

import { useEffect, useMemo, useState } from "react";

const CLOCK_INS_KEY = "tm_clock_ins";
const WEEK_KEY = "tm_week";
const DAILY_KEY = "tm_daily";
const WEEK_SETTINGS_KEY = "tm_week_settings";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const HALF_DAY_OPTIONS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

type DayName = (typeof DAYS)[number];
type OCRStatus = "idle" | "running" | "success" | "error";
type WeekRow = { day: DayName; start: string; end: string; breakMinutes: number; manualMyTime: string };

const defaultWeek = (): WeekRow[] =>
  DAYS.map((day) => ({ day, start: "", end: "", breakMinutes: 0, manualMyTime: "" }));

const toTime = (d: Date) => `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`;
const parseTime = (s: string) => {
  if (!s) return null;
  const [h, m] = s.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m) || h > 23 || m > 59) return null;
  return h * 60 + m;
};
const fmtMin = (n: number) => `${Math.floor(Math.abs(n) / 60)}h ${`${Math.abs(n) % 60}`.padStart(2, "0")}m`;
const wdIndex = (d: Date) => (d.getDay() + 6) % 7;
const AUTO_LUNCH_MINUTES = 45;
const AUTO_LUNCH_TRIGGER_MINUTES = 6 * 60;
const s2my = (h: number, m: number) => h + m / 60;
const my2s = (v: number) => {
  const total = Math.round(v * 60);
  return { h: Math.floor(total / 60), m: total % 60 };
};
const getJSON = <T,>(k: string, fb: T) => {
  if (typeof window === "undefined") return fb;
  try {
    const raw = window.localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fb;
  } catch {
    return fb;
  }
};
const dayFromLine = (line: string): DayName | null => {
  const map: Array<[DayName, RegExp]> = [
    ["Mon", /\b(MON|MONDAY)\b/i],
    ["Tue", /\b(TUE|TUES|TUESDAY)\b/i],
    ["Wed", /\b(WED|WEDNESDAY)\b/i],
    ["Thu", /\b(THU|THUR|THURSDAY)\b/i],
    ["Fri", /\b(FRI|FRIDAY)\b/i],
    ["Sat", /\b(SAT|SATURDAY)\b/i],
  ];
  for (const [d, p] of map) if (p.test(line)) return d;
  return null;
};
const tokenTo24 = (token: string) => {
  const t = token.toUpperCase().replace(/\s+/g, "").replace(".", ":");
  const hasMeridiem = t.endsWith("AM") || t.endsWith("PM");
  const clean = t.replace("AM", "").replace("PM", "");
  const [hRaw, mRaw = "00"] = clean.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (Number.isNaN(h) || Number.isNaN(m) || m > 59) return null;
  if (!hasMeridiem && h < 24) return `${`${h}`.padStart(2, "0")}:${`${m}`.padStart(2, "0")}`;
  if (hasMeridiem && h <= 12) {
    const pm = t.endsWith("PM");
    const hh = (h % 12) + (pm ? 12 : 0);
    return `${`${hh}`.padStart(2, "0")}:${`${m}`.padStart(2, "0")}`;
  }
  return null;
};

export default function Home() {
  const [clockIns, setClockIns] = useState<string[]>(() => getJSON<string[]>(CLOCK_INS_KEY, []));
  const [week, setWeek] = useState<WeekRow[]>(() => getJSON<WeekRow[]>(WEEK_KEY, defaultWeek()));
  const daily = getJSON(DAILY_KEY, { startTime: "", endTime: "17:15", breakMinutes: 0, targetHours: 8, overtimeHours: 8 });
  const wk = getJSON(WEEK_SETTINGS_KEY, { weeklyTargetHours: 40, weeklyOvertimeHours: 40, saturdayWeek: false, halfDay: "Fri" as DayName });
  const [startTime, setStartTime] = useState(daily.startTime || (clockIns[0] ? toTime(new Date(clockIns[0])) : ""));
  const [endTime, setEndTime] = useState(daily.endTime || "17:15");
  const [breakMinutes, setBreakMinutes] = useState(daily.breakMinutes);
  const [targetHours, setTargetHours] = useState(daily.targetHours);
  const [overtimeHours, setOvertimeHours] = useState(daily.overtimeHours);
  const [weeklyTargetHours, setWeeklyTargetHours] = useState(wk.weeklyTargetHours);
  const [weeklyOvertimeHours, setWeeklyOvertimeHours] = useState(wk.weeklyOvertimeHours);
  const [saturdayWeek, setSaturdayWeek] = useState<boolean>(wk.saturdayWeek ?? false);
  const [halfDay, setHalfDay] = useState<DayName>((wk.halfDay as DayName) ?? "Fri");
  const [stdHours, setStdHours] = useState(8);
  const [stdMinutes, setStdMinutes] = useState(30);
  const [myInput, setMyInput] = useState(8.5);
  const [ocrStatus, setOcrStatus] = useState<OCRStatus>("idle");
  const [ocrError, setOcrError] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [ocrRows, setOcrRows] = useState<Partial<WeekRow>[]>([]);

  const clockIn = () => {
    const now = new Date();
    const iso = now.toISOString();
    setClockIns((c) => [iso, ...c].slice(0, 12));
    setStartTime(toTime(now));
    setWeek((rows) => rows.map((r, i) => (i === wdIndex(now) && !r.start ? { ...r, start: toTime(now) } : r)));
  };
  const clearDay = (i: number) => setWeek((rows) => rows.map((r, idx) => (idx === i ? { ...r, start: "", end: "", breakMinutes: 0, manualMyTime: "" } : r)));
  const resetWeek = () => setWeek(defaultWeek());
  const updateClockInTimeOnly = (index: number, timeValue: string) => {
    if (!timeValue) return;
    setClockIns((items) =>
      items.map((raw, idx) => {
        if (idx !== index) return raw;
        const [h, m] = timeValue.split(":").map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) return raw;
        const d = new Date(raw);
        d.setHours(h, m, 0, 0);
        return d.toISOString();
      }),
    );
  };
  const useFirstToday = () => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const first = clockIns.map((v) => new Date(v)).filter((d) => d.getTime() >= dayStart && d.getTime() < dayEnd).sort((a, b) => a.getTime() - b.getTime())[0];
    if (!first) return;
    setWeek((rows) => rows.map((r, i) => (i === wdIndex(now) ? { ...r, start: toTime(first), end: r.end || toTime(now) } : r)));
  };

  const dailySummary = useMemo(() => {
    const s = parseTime(startTime);
    const e0 = parseTime(endTime);
    if (s === null || e0 === null) return null;
    let e = e0;
    if (e < s) e += 1440;
    const gross = e - s;
    const autoLunch = gross > AUTO_LUNCH_TRIGGER_MINUTES ? AUTO_LUNCH_MINUTES : 0;
    const effectiveBreak = breakMinutes > 0 ? breakMinutes : autoLunch;
    const net = Math.max(gross - effectiveBreak, 0);
    const target = Math.round(targetHours * 60);
    const ot = Math.round(overtimeHours * 60);
    const warnings: string[] = [];
    if (effectiveBreak > gross) warnings.push("Daily break exceeds shift.");
    if (gross > 16 * 60) warnings.push("Daily shift > 16h; confirm values.");
    if (targetHours > overtimeHours) warnings.push("Daily target > overtime threshold.");
    return { net, diffTarget: net - target, diffOt: ot - net, warnings, autoLunch, effectiveBreak };
  }, [startTime, endTime, breakMinutes, targetHours, overtimeHours]);

  const weeklySummary = useMemo(() => {
    const activeRows = week.filter((r) => r.day !== "Sat" || saturdayWeek);
    const rows = activeRows.map((r) => {
      const warnings: string[] = [];
      const manual = Number(r.manualMyTime);
      if (r.manualMyTime.trim() !== "") {
        if (Number.isNaN(manual) || manual < 0) warnings.push("Invalid manual myTime.");
        const minutes = Number.isNaN(manual) ? 0 : Math.max(0, Math.round(manual * 60));
        if (minutes > 16 * 60) warnings.push("Manual value > 16h.");
        return { ...r, minutes, my: minutes / 60, warnings };
      }
      const s = parseTime(r.start);
      const e0 = parseTime(r.end);
      if ((s === null) !== (e0 === null)) warnings.push("Missing start or end.");
      if (s === null || e0 === null) return { ...r, minutes: 0, my: 0, warnings };
      let e = e0;
      if (e < s) e += 1440;
      const gross = e - s;
      const autoLunch = gross > AUTO_LUNCH_TRIGGER_MINUTES ? AUTO_LUNCH_MINUTES : 0;
      const minutes = Math.max(gross - autoLunch, 0);
      if (gross > 16 * 60) warnings.push("Shift > 16h.");
      return { ...r, minutes, my: minutes / 60, warnings, autoLunch };
    });
    const total = rows.reduce((a, b) => a + b.minutes, 0);
    const target = Math.round(weeklyTargetHours * 60);
    const ot = Math.round(weeklyOvertimeHours * 60);
    const warnings = rows.flatMap((r) => r.warnings.map((w) => `${r.day}: ${w}`));
    if (weeklyTargetHours > weeklyOvertimeHours) warnings.push("Weekly target > weekly overtime threshold.");
    if (total > ot) warnings.push("Weekly total is over overtime threshold.");
    return { rows, total, my: total / 60, diffTarget: total - target, diffOt: ot - total, warnings };
  }, [week, weeklyTargetHours, weeklyOvertimeHours, saturdayWeek]);

  const warnings = [...(dailySummary?.warnings ?? []), ...weeklySummary.warnings];

  const importScreenshot = async (file: File) => {
    setOcrStatus("running");
    setOcrError("");
    try {
      const t = await import("tesseract.js");
      const out = await t.recognize(file, "eng");
      const text = out.data.text ?? "";
      setOcrText(text);
      const parsed: Partial<WeekRow>[] = [];
      for (const line of text.split("\n").map((v) => v.trim()).filter(Boolean)) {
        const d = dayFromLine(line);
        if (!d) continue;
        const tokens = line.match(/\b\d{1,2}(?::|\.)\d{2}\s*(?:AM|PM)?\b/gi) ?? line.match(/\b\d{1,2}\s*(?:AM|PM)\b/gi) ?? [];
        const times = tokens.map((k) => tokenTo24(k)).filter((v): v is string => Boolean(v));
        const dec = line.match(/\b\d{1,2}\.\d{1,2}\b/);
        parsed.push({ day: d, start: times[0] ?? "", end: times[1] ?? "", manualMyTime: dec?.[0] ?? "" });
      }
      setOcrRows(parsed);
      setOcrStatus("success");
    } catch (e) {
      setOcrStatus("error");
      setOcrError(e instanceof Error ? e.message : "OCR failed");
    }
  };

  useEffect(() => window.localStorage.setItem(CLOCK_INS_KEY, JSON.stringify(clockIns)), [clockIns]);
  useEffect(() => window.localStorage.setItem(WEEK_KEY, JSON.stringify(week)), [week]);
  useEffect(() => window.localStorage.setItem(DAILY_KEY, JSON.stringify({ startTime, endTime, breakMinutes, targetHours, overtimeHours })), [startTime, endTime, breakMinutes, targetHours, overtimeHours]);
  useEffect(() => window.localStorage.setItem(WEEK_SETTINGS_KEY, JSON.stringify({ weeklyTargetHours, weeklyOvertimeHours, saturdayWeek, halfDay })), [weeklyTargetHours, weeklyOvertimeHours, saturdayWeek, halfDay]);
  useEffect(() => {
    if (!saturdayWeek) return;
    setWeek((rows) =>
      rows.map((r) => {
        const isAutoPattern = r.start === "08:30" && r.end === "12:15" && r.manualMyTime === "4.00";
        if (r.day === "Sat") return { ...r, start: "08:30", end: "12:15", manualMyTime: "4.00" };
        if (r.day === halfDay) return { ...r, start: "08:30", end: "12:15", manualMyTime: "4.00" };
        if (HALF_DAY_OPTIONS.includes(r.day as (typeof HALF_DAY_OPTIONS)[number]) && isAutoPattern) {
          return { ...r, start: "", end: "", manualMyTime: "" };
        }
        return r;
      }),
    );
  }, [saturdayWeek, halfDay]);

  const my = my2s(myInput);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_10%_0%,#bfdbfe_0,#e0f2fe_28%,#f8fafc_64%)] px-3 py-5 pb-24 text-slate-900 sm:px-6 sm:py-8 sm:pb-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:gap-6">
        <header className="rounded-3xl border border-sky-100 bg-white/90 p-5 shadow-sm">
          <h1 className="text-2xl font-bold sm:text-3xl">Timesheet Toolkit</h1>
          <p className="mt-2 text-sm text-slate-600">App-style tracking with guardrails and screenshot import.</p>
        </header>

        <section className="grid gap-3 rounded-2xl border bg-white p-4 shadow-sm md:grid-cols-2">
          <div><h2 className="font-semibold">myTime to Standard</h2><input type="number" min={0} step="0.01" value={myInput} onChange={(e) => setMyInput(Number(e.target.value) || 0)} className="mt-2 w-32 rounded-lg border px-3 py-2 text-sm" /><p className="mt-2 text-xl font-bold text-sky-700">{my.h}h {`${my.m}`.padStart(2, "0")}m</p></div>
          <div><h2 className="font-semibold">Standard to myTime</h2><div className="mt-2 flex gap-2"><input type="number" min={0} value={stdHours} onChange={(e) => setStdHours(Number(e.target.value) || 0)} className="w-24 rounded-lg border px-3 py-2 text-sm" /><input type="number" min={0} max={59} value={stdMinutes} onChange={(e) => setStdMinutes(Math.min(59, Math.max(0, Number(e.target.value) || 0)))} className="w-24 rounded-lg border px-3 py-2 text-sm" /></div><p className="mt-2 text-xl font-bold text-sky-700">{s2my(stdHours, stdMinutes).toFixed(2)} myTime</p></div>
        </section>

        {warnings.length > 0 && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm">{warnings.map((w, i) => <p key={`${w}-${i}`}>- {w}</p>)}</section>}

        <section className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="font-semibold">Quick Clock-In</h2>
            <button onClick={clockIn} className="mt-3 w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white">Clock In Time</button>
            <ul className="mt-3 space-y-2">
              {clockIns.map((v, i) => (
                <li key={`${v}-${i}`} className="rounded-lg bg-slate-50 p-2">
                  <input type="time" value={toTime(new Date(v))} onChange={(e) => updateClockInTimeOnly(i, e.target.value)} className="w-full rounded-md border px-2 py-1.5 text-sm" />
                  <button onClick={() => setClockIns((c) => c.filter((_, idx) => idx !== i))} className="mt-2 w-full rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">Delete Entry</button>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-2xl border bg-white p-4 shadow-sm lg:col-span-2">
            <h2 className="font-semibold">Daily Shift Balance</h2>
            <p className="mt-1 text-sm text-slate-600">Clarity view: worked time, auto lunch, add/cut, and overtime buffer.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs text-slate-600">Start<input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
              <label className="text-xs text-slate-600">End<input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
              <label className="text-xs text-slate-600">Manual Break (min)<input type="number" min={0} value={breakMinutes} onChange={(e) => setBreakMinutes(Number(e.target.value) || 0)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
              <label className="text-xs text-slate-600">Target Hours<input type="number" min={0} step="0.25" value={targetHours} onChange={(e) => setTargetHours(Number(e.target.value) || 0)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
              <label className="text-xs text-slate-600">Overtime Starts<input type="number" min={0} step="0.25" value={overtimeHours} onChange={(e) => setOvertimeHours(Number(e.target.value) || 0)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3 text-sm">
              <div className="rounded-xl bg-slate-50 p-3">Worked: {dailySummary ? fmtMin(dailySummary.net) : "--"}</div>
              <div className="rounded-xl bg-slate-50 p-3">
                Break Used: {dailySummary ? `${dailySummary.effectiveBreak} min${breakMinutes > 0 ? " (manual)" : " (auto)"}` : "--"}
              </div>
              <div className="rounded-xl bg-slate-50 p-3">{dailySummary ? dailySummary.diffTarget < 0 ? `Add ${fmtMin(dailySummary.diffTarget)}`.replace("-", "") : dailySummary.diffTarget > 0 ? `Cut ${fmtMin(dailySummary.diffTarget)}` : "On target" : "--"}</div>
              <div className="rounded-xl bg-slate-50 p-3">{dailySummary ? dailySummary.diffOt >= 0 ? `${fmtMin(dailySummary.diffOt)} left` : `${fmtMin(dailySummary.diffOt).replace("-", "")} over` : "--"}</div>
            </div>
          </article>
        </section>

        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Import From Screenshot</h2>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importScreenshot(f); }} className="mt-2 block w-full rounded-lg border bg-slate-50 px-3 py-2 text-sm" />
          {ocrStatus === "running" && <p className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-700">Running OCR...</p>}
          {ocrStatus === "error" && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">OCR error: {ocrError}</p>}
          {ocrStatus === "success" && (
            <div className="mt-2 space-y-2">
              <button onClick={() => setWeek((rows) => rows.map((row) => ({ ...row, ...(ocrRows.find((x) => x.day === row.day) ?? {}) })))} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700">Apply Imported Data</button>
              <div className="grid gap-2 sm:grid-cols-2 text-sm">{ocrRows.map((r, i) => <div key={`${r.day ?? "row"}-${i}`} className="rounded-lg border bg-slate-50 p-3">{r.day}: {r.start || "-"} - {r.end || "-"} {r.manualMyTime ? `(myTime ${r.manualMyTime})` : ""}</div>)}</div>
              <details><summary className="cursor-pointer text-sm">View OCR text</summary><pre className="mt-2 max-h-44 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{ocrText}</pre></details>
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-4">
            <button onClick={useFirstToday} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700">Use First Clock-In Today</button>
            <button onClick={resetWeek} className="rounded-lg border px-3 py-2 text-sm font-semibold">Reset Week</button>
            <input type="number" min={0} step="0.25" value={weeklyTargetHours} onChange={(e) => setWeeklyTargetHours(Number(e.target.value) || 0)} className="rounded-lg border px-3 py-2 text-sm" placeholder="Weekly target" />
            <input type="number" min={0} step="0.25" value={weeklyOvertimeHours} onChange={(e) => setWeeklyOvertimeHours(Number(e.target.value) || 0)} className="rounded-lg border px-3 py-2 text-sm" placeholder="Weekly overtime" />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <input type="checkbox" checked={saturdayWeek} onChange={(e) => setSaturdayWeek(e.target.checked)} />
              Saturday Week
            </label>
            <label className="text-xs text-slate-600 sm:col-span-2">Half Day
              <select value={halfDay} onChange={(e) => setHalfDay(e.target.value as DayName)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" disabled={!saturdayWeek}>
                {HALF_DAY_OPTIONS.map((day) => <option key={day} value={day}>{day}</option>)}
              </select>
            </label>
          </div>
          <p className="mt-2 text-sm text-slate-600">Standard rows auto-deduct 45 min lunch if shift exceeds 6 hours.</p>
          <div className="mt-3 space-y-2">
            {week.map((r, i) => (
              (r.day === "Sat" && !saturdayWeek) ? null : (
              <div key={r.day} className="grid gap-2 rounded-xl border bg-slate-50 p-3 sm:grid-cols-[48px,1fr,1fr,130px,90px]">
                <div className="text-sm font-semibold">{r.day}</div>
                <input type="time" value={r.start} onChange={(e) => setWeek((rows) => rows.map((x, idx) => idx === i ? { ...x, start: e.target.value } : x))} className="rounded-lg border px-2 py-1.5 text-sm" />
                <input type="time" value={r.end} onChange={(e) => setWeek((rows) => rows.map((x, idx) => idx === i ? { ...x, end: e.target.value } : x))} className="rounded-lg border px-2 py-1.5 text-sm" />
                <input type="number" min={0} step="0.01" value={r.manualMyTime} onChange={(e) => setWeek((rows) => rows.map((x, idx) => idx === i ? { ...x, manualMyTime: e.target.value } : x))} className="rounded-lg border px-2 py-1.5 text-sm" />
                <button onClick={() => clearDay(i)} className="rounded-lg border px-2 py-1.5 text-xs font-semibold">Clear</button>
              </div>
              )
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4 text-sm">
            <div className="rounded-xl bg-slate-50 p-3">Week: {fmtMin(weeklySummary.total)} ({weeklySummary.my.toFixed(2)} myTime)</div>
            <div className="rounded-xl bg-slate-50 p-3">{weeklySummary.diffTarget < 0 ? `Short ${fmtMin(weeklySummary.diffTarget).replace("-", "")}` : weeklySummary.diffTarget > 0 ? `Over ${fmtMin(weeklySummary.diffTarget)}` : "Even"}</div>
            <div className="rounded-xl bg-slate-50 p-3">{weeklySummary.diffTarget < 0 ? `Add ${fmtMin(weeklySummary.diffTarget).replace("-", "")}` : weeklySummary.diffTarget > 0 ? `Cut ${fmtMin(weeklySummary.diffTarget)}` : "On target"}</div>
            <div className="rounded-xl bg-slate-50 p-3">{weeklySummary.diffOt >= 0 ? `${fmtMin(weeklySummary.diffOt)} left` : `${fmtMin(weeklySummary.diffOt).replace("-", "")} over`}</div>
          </div>
        </section>

      </div>

      <div className="fixed inset-x-3 bottom-3 z-20 flex gap-2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur sm:hidden">
        <button onClick={clockIn} className="flex-1 rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white">Clock In</button>
        <button onClick={useFirstToday} className="flex-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700">Use First</button>
        <button onClick={resetWeek} className="flex-1 rounded-xl border px-3 py-2 text-sm font-semibold">Reset</button>
      </div>
    </main>
  );
}
