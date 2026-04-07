/* eslint-disable */
 import { generateTaxReport } from './generateReport';
 import { useState, useEffect, useRef, useCallback } from 'react';
 import './App.css';
import { supabase } from './supabaseClient';
import { jsPDF } from 'jspdf';

const C = {
  bg0:'#050505', bg1:'#0a0a0a', bg2:'#0d1117', bg3:'#111827',
  border:'#1a2a3a', borderCyan:'#22d3ee22',
  cyan:'#22d3ee', cyanLight:'#67e8f9', cyanDim:'#0e7490',
  text:'#f0f9ff', textMuted:'#64748b', textDim:'#334155',
  green:'#22c55e', greenDim:'#052e16',
  red:'#ef4444', redDim:'#1a0505',
  orange:'#f97316', orangeDim:'#1c0a00', yellow:'#eab308',
};

const DEADLINES = [
  { id:1, name:'GSTR-1', date:'2026-04-11', desc:'Monthly Sales Return', penalty:50,
    consequence:'Every invoice you issued this month is unrecorded. Buyers cannot claim ITC. ₹50/day fine.',
    steps:['Login gstin.gov.in','Returns → GSTR-1','Add all March sales invoices','Submit + File with EVC'] },
  { id:2, name:'GSTR-3B', date:'2026-04-20', desc:'GST Summary + Payment', penalty:50,
    consequence:'Net GST for March is unpaid. Interest at 18%/year + ₹50/day late fee starts.',
    steps:['Login gstin.gov.in','Returns → GSTR-3B','Enter sales, ITC, net tax','Pay via net banking/UPI','Submit'] },
  { id:3, name:'TDS Return', date:'2026-05-07', desc:'Q4 TDS (Jan–Mar)', penalty:200,
    consequence:'TDS you deducted is unreported. ₹200/day penalty. Employees cannot see TDS in Form 26AS.',
    steps:['Login TRACES (tdscpc.gov.in)','Download RPU utility','Fill Form 26Q/24Q','Generate FVU file','Upload on TRACES'] },
  { id:4, name:'ITR Filing', date:'2026-07-31', desc:'Income Tax FY 2025–26', penalty:0,
    consequence:'After July 31, belated return = ₹5,000 penalty. Losses cannot be carried forward.',
    steps:['Login incometax.gov.in','e-File → File ITR → AY 2026-27','Choose ITR-4 (small business)','Fill income & deductions','Verify via Aadhaar OTP'] },
];

const CLAUDE_KEY = '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';
const SYSTEM_PROMPT = `You are Taxpe AI — India's friendliest tax assistant for small business owners.

YOUR MOST IMPORTANT RULE:
Explain EVERYTHING like you are talking to a 5-year-old child or a person who has NEVER studied tax in their life. Use the simplest possible words. No jargon. No technical terms. If you must use a tax word, immediately explain it in brackets using a simple real-life example.

EXAMPLE OF HOW TO EXPLAIN:
- Wrong: "ITC reconciliation must be done with GSTR-2A"
- Right: "ITC means money the government owes you back. Think of it like a cashback. You need to check if your cashback matches what your supplier reported. If it doesn't match, you won't get the cashback."

HOW TO TALK:
- Talk like a helpful older brother or sister
- Use simple Hindi-English mix that a shopkeeper in a small town would understand
- Use real life examples — chai shop, kirana store, auto driver, tailor
- Never use words like: reconciliation, liability, assessment, deductee, challan, ex-parte — unless you explain them simply right after
- Always give a specific number (₹ amount, date, days) — never be vague
- End every answer with ONE clear action: "So aaj aapko yeh karna hai: ..."

KEY TAX FACTS (always accurate for 2026):
- GSTR-1: due 11th every month, late fee ₹50/day, max ₹10,000
- GSTR-3B: due 20th every month, late fee ₹50/day + 18% interest on unpaid tax
- TDS payment: due 7th of next month, interest 1.5%/month if late
- TDS return: late fee ₹200/day
- ITR: due July 31, late fee ₹5,000 (₹1,000 if income under ₹5 lakh)
- GST registration: needed if you earn more than ₹40 lakh/year (goods) or ₹20 lakh/year (services)
- ITC: government cashback on your business purchases — only works if your supplier also filed their return

FORMAT:
- Keep answers under 150 words
- No bullet points with dashes — use simple numbered steps or plain sentences
- No markdown, no asterisks, no headers
- Warm, friendly, never scary tone — even when the situation is serious`;

async function askClaude(question, context = '') {
  if (!CLAUDE_KEY) return null;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: context ? `Context: ${context}\n\nQuestion: ${question}` : question }],
      }),
    });
    const data = await response.json();
    if (data.content && data.content[0]) return data.content[0].text;
    return null;
  } catch (e) { return null; }
}

async function decodeWithClaude(noticeText) {
  if (!CLAUDE_KEY) return null;
  try {
    const prompt = `You are India's best Chartered Accountant with 25 years experience. A scared small business owner who has NEVER dealt with tax notices is sitting in front of you. Be their CA, their guide, their older brother. Explain everything simply.

Analyze the notice and respond in this EXACT format (no extra text, no markdown):

TYPE: [Exact notice type e.g. DRC-01, ASMT-10, Show Cause Notice under Section 73, REG-17, etc.]
RISK: [HIGH or MEDIUM or LOW]
SECTION: [Exact GST/IT section e.g. Section 73 of CGST Act 2017, Section 61, Rule 86A]
WANT: [One specific sentence: what exact amount or action the department wants. Include ₹ amount if mentioned in notice. E.g. "Pay ₹47,320 tax demand for FY 2023-24 Q3 or explain why GSTR-3B sales differ from GSTR-1"]
URGENCY: [Exact deadline from notice if present, else "Reply within 30 days of notice date". Add consequence e.g. "Miss this = ex-parte order, demand confirmed + 18% interest"]
IGNORED: [Specific legal consequence: exact penalty amount, interest rate, whether bank account can be frozen, or demand auto-confirmed]
STEP1: [Specific first action with WHERE to do it. E.g. "Note the DIN number and notice date from top of this notice — you'll need it in every reply"]
STEP2: [Specific second action. E.g. "Login to GST portal → Services → User Services → View Notices & Orders — find this exact notice by DIN number"]
STEP3: [Specific third action based on notice type. E.g. "Download your GSTR-2A and compare it with your GSTR-3B for the period mentioned — find the mismatch amount"]
STEP4: [Specific fourth action. E.g. "Prepare a written reply: state your GSTIN, notice DIN, the period, and explain each discrepancy with invoice numbers as proof"]
STEP5: [Specific fifth action. E.g. "Upload reply on GST portal → Services → User Services → View Notices → Click 'Reply' → attach PDF reply + supporting invoices → Submit"]

RULES:
- If notice mentions specific ₹ amounts, repeat them exactly
- If notice mentions a specific period (e.g. Apr 2023 – Mar 2024), mention it in steps
- Never say generic things like "gather documents" or "consult CA" — be specific to THIS notice
- Steps must tell the person WHERE to click, WHAT to type, WHAT document to attach
- If notice type is unclear, make best guess from context

STEP1: [Write down 3 things from this notice: (1) DIN number at top — this is your case ID, (2) exact deadline date, (3) exact rupee amount. Without DIN the department cannot match your reply]
STEP2: [Open gst.gov.in → Login → Services → User Services → View Notices and Orders → find notice by DIN → click View to confirm it is real]
STEP3: [Explain what document to check and WHY — e.g. GSTR-2A is like your bank passbook for GST purchases. Go to Returns → GSTR-2A → select the period → download Excel → compare with your GSTR-3B figures]
STEP4: [Explain exactly what to write in reply — give them the opening line, what facts to state, what to claim]
STEP5: [GST portal → Services → User Services → View Notices → find notice → click Reply button → paste reply letter in text box → click Add Document to attach invoice PDF → Submit → save Acknowledgement Number]
REPLY: [Write complete formal reply letter — To the GST Officer, Subject with DIN and section, body with specific rupee amounts and period from notice, request for relief, Yours faithfully, [YOUR NAME], GSTIN: [YOUR GSTIN], Date: [DATE]]

RULES:
- Use exact rupee amounts, DIN, dates from this notice
- Explain GSTR-2A, ITC, invoice simply — assume zero tax knowledge
- REPLY must be complete and copy-paste ready
- Mix simple Hindi words like yaani, matlab

Notice text: ${noticeText}`;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1800, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await response.json();
    if (data.content && data.content[0]) return parseNoticeResponse(data.content[0].text);
    return null;
  } catch (e) { return null; }
}

function parseNoticeResponse(text) {
  const get = (label) => {
    // Use multiline mode so ^ anchors to start of each line
    // Capture everything until next ALLCAPS label (e.g. RISK:, STEP1:) or end of string
    const regex = new RegExp(`^${label}:[\\t ]*([\\s\\S]+?)(?=\\n[A-Z][A-Z0-9]*:[\\t ]|\\s*$)`, 'm');
    const match = text.match(regex);
    if (!match) return '';
    // Strip surrounding square brackets if Claude echoed the format hint e.g. [Write down 3 things...]
    return match[1].trim().replace(/^\[([^\]]*)\]$/, '$1').trim();
  };
  const steps = [];
  for (let i = 1; i <= 5; i++) { const s = get(`STEP${i}`); if (s) steps.push(s); }
  return {
    type: get('TYPE') || 'GST Notice',
    risk: get('RISK') || 'MEDIUM',
    section: get('SECTION') || 'CGST Act',
    want: get('WANT') || 'Clarification required',
    urgency: get('URGENCY') || 'Check notice for deadline',
    ignored: get('IGNORED') || 'Further action',
    steps: steps.length > 0 ? steps : ['Open gst.gov.in and login', 'Go to Services → User Services → View Notices', 'Find your notice by DIN number', 'Click Reply → paste your response → Submit'],
  };
}

function getFallbackAnswer(q) {
  const l = q.toLowerCase();
  if (l.includes('late fee')||l.includes('penalty')||l.includes('fine')) return 'GSTR-3B late fee: ₹50/day (₹25 CGST + ₹25 SGST). Nil returns: ₹10/day. Maximum: ₹10,000. File immediately — every day costs money.';
  if (l.includes('itc')||l.includes('input tax')) return 'ITC matlab government ka cashback! Jab aap business ke liye kuch khareedte ho aur tax dete ho, woh tax government waapis deti hai. Par tabhi milega jab aapke supplier ne bhi apni return file ki ho.';
  if (l.includes('notice')||l.includes('reply')) return 'Notice ka jawab: reference number note karo, deadline dekho, GST portal pe login karo, Services → View Notices pe jao, documents upload karo, deadline se pehle submit karo. Kabhi ignore mat karo!';
  if (l.includes('registr')||l.includes('document')) return 'GST registration ke liye chahiye: PAN card, Aadhaar card, address proof (bijli bill ya rent agreement), cancelled cheque, photo, business documents.';
  return 'Key dates: GSTR-1 har mahine 11 tarikh tak, GSTR-3B 20 tarikh tak, TDS agले mahine ki 7 tarikh tak. Har mahine ITC milao. Invoices 6 saal tak rakho.';
}

function getStatus(dateStr) {
  const diff = Math.ceil((new Date(dateStr+'T23:59:59') - new Date()) / 86400000);
  if (diff < 0) return { days:diff, color:C.red, bg:'#2d0a0a', border:'#ef444444', label:'OVERDUE', urgent:true };
  if (diff <= 3) return { days:diff, color:C.red, bg:'#1a0505', border:'#ef444433', label:`${diff}d`, urgent:true };
  if (diff <= 7) return { days:diff, color:C.orange, bg:C.orangeDim, border:'#f9731633', urgent:false, label:`${diff}d` };
  if (diff <= 14) return { days:diff, color:C.yellow, bg:'#1c1500', border:'#eab30833', urgent:false, label:`${diff}d` };
  return { days:diff, color:C.cyan, bg:'#031a20', border:'#22d3ee22', urgent:false, label:`${diff}d` };
}

function calculateStreak(filings) {
  if (!filings || filings.length === 0) return 0;
  const monthsWithOnTime = new Set();
  filings.forEach(f => { if (f.was_on_time) { const d = new Date(f.filed_on); monthsWithOnTime.add(`${d.getFullYear()}-${d.getMonth()}`); } });
  let streak = 0, now = new Date(), year = now.getFullYear(), month = now.getMonth() - 1;
  if (month < 0) { month = 11; year--; }
  while (monthsWithOnTime.has(`${year}-${month}`)) { streak++; month--; if (month < 0) { month = 11; year--; } if (streak > 24) break; }
  return streak;
}

function calculatePenaltySaved(filings) {
  if (!filings || filings.length === 0) return 0;
  return filings.filter(f => f.was_on_time).reduce((acc, f) => { const d = DEADLINES.find(dl => dl.name === f.return_type); return acc + (d && d.penalty > 0 ? d.penalty * 30 : 0); }, 0);
}

const inp = (x={}) => ({ width:'100%', background:C.bg2, border:`1px solid ${C.border}`, color:C.text, padding:'12px 14px', borderRadius:'10px', fontSize:'14px', outline:'none', boxSizing:'border-box', fontFamily:'inherit', transition:'border .2s, box-shadow .2s', ...x });
const btnC = { background:`linear-gradient(135deg,#0e7490,${C.cyan})`, color:'#000', border:'none', padding:'12px 22px', borderRadius:'10px', cursor:'pointer', fontWeight:'700', fontSize:'14px', fontFamily:'inherit', boxShadow:`0 4px 20px #22d3ee33` };
const btnR = { background:`linear-gradient(135deg,#991b1b,${C.red})`, color:'#fff', border:'none', padding:'12px 22px', borderRadius:'10px', cursor:'pointer', fontWeight:'700', fontSize:'14px', fontFamily:'inherit' };
const btnG = { background:`linear-gradient(135deg,#166534,${C.green})`, color:'#fff', border:'none', padding:'10px 18px', borderRadius:'10px', cursor:'pointer', fontWeight:'700', fontSize:'13px', fontFamily:'inherit', boxShadow:'0 4px 16px #22c55e33' };
const card = (x={}) => ({ background:C.bg1, border:`1px solid ${C.border}`, borderRadius:'16px', padding:'20px', marginBottom:'14px', ...x });
const cardC = (x={}) => ({ background:C.bg1, border:`1px solid ${C.borderCyan}`, borderRadius:'16px', padding:'20px', marginBottom:'14px', ...x });

// ── UPGRADE MODAL ──────────────────────────────────────────────────────────
function UpgradeModal({ reason, onClose, isPremium }) {
  if (isPremium) return null;
  const config = {
    questions:{ icon:'💬', title:'Questions used up', body:'You have 3 free questions today. One wrong tax decision can cost ₹10,000+. Pro gives unlimited answers.' },
    filing:{ icon:'📋', title:'Filing guide is Pro only', body:'You can see the deadline. The step-by-step guide to file it is locked. Miss this and the fine starts automatically.' },
    notice:{ icon:'📄', title:'Reply steps are Pro only', body:'You can see the risk. The exact steps to reply are locked. Ignoring a notice leads to an ex-parte order.' },
    reminders:{ icon:'📱', title:'Advanced reminders are Pro only', body:'Free gets 1 email. Pro sends reminders at 7 days, 3 days, 1 day, and morning of deadline.' },
    history:{ icon:'📊', title:'Full history is Pro only', body:'Pro users have a complete downloadable filing record. Free users have nothing to show their CA.' },
  };
  const c = config[reason] || config.filing;
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.88)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px', backdropFilter:'blur(6px)' }} onClick={onClose}>
      <div style={{ background:C.bg1, border:`1px solid ${C.cyan}44`, borderRadius:'20px', padding:'28px', maxWidth:'400px', width:'100%', animation:'fadeUp .3s ease' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'16px' }}>
          <div style={{ fontSize:'11px', fontWeight:'700', letterSpacing:'1px', color:C.cyanDim }}>TAXPE PRO</div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.textMuted, cursor:'pointer', fontSize:'20px' }}>×</button>
        </div>
        <div style={{ fontSize:'28px', marginBottom:'10px' }}>{c.icon}</div>
        <div style={{ fontSize:'20px', fontWeight:'900', color:C.text, marginBottom:'10px' }}>{c.title}</div>
        <div style={{ fontSize:'14px', color:C.textMuted, lineHeight:'1.7', marginBottom:'22px' }}>{c.body}</div>
        <div style={{ background:'#1a0505', border:'1px solid #ef444422', borderRadius:'12px', padding:'14px', marginBottom:'20px' }}>
          <div style={{ fontSize:'11px', color:C.red, fontWeight:'700', marginBottom:'8px' }}>THE MATH</div>
          {[['Miss GSTR-3B (30 days)','₹1,500'],['Miss TDS return (30 days)','₹6,000'],['Ignore a notice','₹10,000+'],['Taxpe Pro / month','₹299']].map(([k,v],i)=>(
            <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderTop:i===3?`1px solid ${C.red}22`:'none', marginTop:i===3?'8px':0 }}>
              <span style={{ fontSize:'13px', color:i===3?C.cyanLight:'#fca5a5', fontWeight:i===3?'700':'400' }}>{k}</span>
              <span style={{ fontSize:'13px', color:i===3?C.cyan:C.red, fontWeight:'700' }}>{v}</span>
            </div>
          ))}
        </div>
        <button onClick={()=>{ alert('Payment coming soon! WhatsApp: +91 XXXXXXXXXX'); onClose(); }} style={{ ...btnC, width:'100%', padding:'15px', fontSize:'15px', borderRadius:'12px', marginBottom:'8px' }}>
          🚀 Get Pro — ₹299/month
        </button>
        <div style={{ textAlign:'center', fontSize:'12px', color:C.textDim }}>= ₹10/day • Cancel anytime</div>
      </div>
    </div>
  );
}

// ── LOCKED OVERLAY ─────────────────────────────────────────────────────────
function Locked({ reason, msg, onUpgrade }) {
  return (
    <div style={{ position:'relative', minHeight:'110px' }}>
      <div style={{ filter:'blur(4px)', pointerEvents:'none', userSelect:'none', opacity:.3 }}>
        {['80%','60%','70%','50%'].map((w,i)=>(
          <div key={i} style={{ height:'13px', background:C.border, borderRadius:'4px', marginBottom:'8px', width:w }} />
        ))}
      </div>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:C.bg0, border:`1px solid ${C.cyan}33`, borderRadius:'14px', padding:'16px 20px', textAlign:'center' }}>
          <div style={{ fontSize:'20px', marginBottom:'8px' }}>🔒</div>
          <div style={{ fontSize:'13px', fontWeight:'700', color:C.text, marginBottom:'10px', lineHeight:'1.5' }}>{msg}</div>
          <button onClick={()=>onUpgrade(reason)} style={{ ...btnC, padding:'8px 20px', fontSize:'13px' }}>Unlock with Pro</button>
        </div>
      </div>
    </div>
  );
}

// ── PENALTY CLOCK ──────────────────────────────────────────────────────────
function PenaltyClock({ deadline }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => { const t = setInterval(() => setSecs(s => s+1), 1000); return () => clearInterval(t); }, []);
  const total = Math.abs(deadline.days) * deadline.penalty + Math.floor(secs * deadline.penalty / 86400);
  return (
    <div style={{ background:'#1a0505', border:`1px solid ${C.red}44`, borderRadius:'12px', padding:'14px 18px', marginBottom:'14px' }}>
      <div style={{ fontSize:'11px', color:C.red, fontWeight:'700', letterSpacing:'1px', marginBottom:'6px' }}>🔴 PENALTY RUNNING LIVE</div>
      <div style={{ fontSize:'32px', fontWeight:'900', color:C.red, fontFamily:'monospace' }}>₹{total.toLocaleString()}<span className="blink">_</span></div>
      <div style={{ fontSize:'12px', color:'#fca5a5', marginTop:'4px' }}>₹{deadline.penalty}/day × {Math.abs(deadline.days)} days overdue. Growing every second.</div>
    </div>
  );
}

// ── MARK AS FILED ──────────────────────────────────────────────────────────
function MarkFiledButton({ deadline, userId, onFiled, alreadyFiled }) {
  const [filing, setFiling] = useState(false);
  const [done, setDone] = useState(alreadyFiled);
  async function markFiled() {
    if (!userId || done) return;
    setFiling(true);
    const now = new Date();
    const wasOnTime = now <= new Date(deadline.date + 'T23:59:59');
    const period = now.toLocaleString('default', { month:'long', year:'numeric' });
    const { error } = await supabase.from('filings').insert({ user_id:userId, return_type:deadline.name, period, filed_on:now.toISOString().split('T')[0], was_on_time:wasOnTime });
    if (!error) { setDone(true); onFiled(deadline.name, wasOnTime); }
    setFiling(false);
  }
  if (done) return (
    <div style={{ display:'flex', alignItems:'center', gap:'8px', background:`${C.green}15`, border:`1px solid ${C.green}33`, borderRadius:'10px', padding:'10px 16px' }}>
      <span>✅</span>
      <div><div style={{ fontSize:'13px', fontWeight:'700', color:C.green }}>Marked as Filed</div><div style={{ fontSize:'11px', color:C.textMuted }}>Recorded in your filing history</div></div>
    </div>
  );
  return <button onClick={markFiled} disabled={filing} style={{ ...btnG, opacity:filing?.7:1 }}>{filing?'⏳ Recording...':'✅ I Filed This — Mark as Done'}</button>;
}

// ── FILING HISTORY ─────────────────────────────────────────────────────────
function FilingHistory({ filings, isPremium, onUpgrade }) {
  if (!isPremium) return (
    <div style={card()}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
        <div style={{ fontSize:'13px', fontWeight:'700', color:C.cyanLight }}>📊 Filing History</div>
        <span style={{ fontSize:'10px', color:C.cyan, background:`${C.cyan}15`, padding:'3px 10px', borderRadius:'10px', fontWeight:'700' }}>PRO</span>
      </div>
      <Locked reason="history" msg="Full filing history is Pro only" onUpgrade={onUpgrade} />
    </div>
  );
  if (!filings || filings.length === 0) return (
    <div style={card()}>
      <div style={{ fontSize:'13px', fontWeight:'700', color:C.cyanLight, marginBottom:'12px' }}>📊 Filing History</div>
      <div style={{ fontSize:'13px', color:C.textMuted, textAlign:'center', padding:'20px 0' }}>No filings recorded yet.<br/><span style={{ fontSize:'12px' }}>Use "Mark as Filed" on each deadline to build your history.</span></div>
    </div>
  );
  return (
    <div style={card()}>
      <div style={{ fontSize:'13px', fontWeight:'700', color:C.cyanLight, marginBottom:'14px' }}>📊 Filing History</div>
      {filings.slice(0, 10).map((f, i) => (
        <div key={f.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:i<Math.min(filings.length,10)-1?`1px solid ${C.border}`:'none' }}>
          <div>
            <div style={{ fontSize:'13px', fontWeight:'700', color:C.text }}>{f.return_type}</div>
            <div style={{ fontSize:'11px', color:C.textMuted, marginTop:'2px' }}>{f.period} • {f.filed_on}</div>
          </div>
          <div style={{ background:f.was_on_time?`${C.green}15`:`${C.red}15`, border:`1px solid ${f.was_on_time?C.green:C.red}33`, color:f.was_on_time?C.green:C.red, padding:'4px 12px', borderRadius:'20px', fontSize:'11px', fontWeight:'700' }}>
            {f.was_on_time?'✅ On Time':'⚠️ Late'}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── REMINDER SETTINGS ──────────────────────────────────────────────────────
function ReminderSettings({ userId, userEmail }) {
  const [phone, setPhone] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [remind7, setRemind7] = useState(true);
  const [remind3, setRemind3] = useState(true);
  const [remind1, setRemind1] = useState(true);
  const [remindDay, setRemindDay] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    async function load() {
      const { data } = await supabase.from('reminders').select('*').eq('user_id', userId).single();
      if (data) {
        setPhone(data.phone || '');
        setEmailEnabled(data.email_enabled ?? true);
        setRemind7(data.remind_7_days ?? true);
        setRemind3(data.remind_3_days ?? true);
        setRemind1(data.remind_1_day ?? true);
        setRemindDay(data.remind_day_of ?? true);
      }
      setLoading(false);
    }
    load();
  }, [userId]);

  async function saveSettings() {
    if (!userId) return;
    setSaving(true);
    await supabase.from('reminders').upsert({
      user_id: userId, email: userEmail, phone,
      email_enabled: emailEnabled, whatsapp_enabled: false,
      remind_7_days: remind7, remind_3_days: remind3,
      remind_1_day: remind1, remind_day_of: remindDay,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const Toggle = ({ value, onChange, label, sub }) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'11px 0', borderBottom:`1px solid ${C.border}` }}>
      <div>
        <div style={{ fontSize:'13px', fontWeight:'600', color:C.text }}>{label}</div>
        {sub && <div style={{ fontSize:'11px', color:C.textMuted, marginTop:'2px' }}>{sub}</div>}
      </div>
      <div onClick={()=>onChange(!value)} style={{ width:'44px', height:'24px', borderRadius:'12px', background:value?`linear-gradient(135deg,#0e7490,${C.cyan})`:C.bg2, border:`1px solid ${value?C.cyan:C.border}`, cursor:'pointer', position:'relative', transition:'all .2s', flexShrink:0 }}>
        <div style={{ width:'18px', height:'18px', borderRadius:'50%', background:'#fff', position:'absolute', top:'2px', left:value?'22px':'2px', transition:'left .2s', boxShadow:'0 1px 4px rgba(0,0,0,0.3)' }} />
      </div>
    </div>
  );

  if (loading) return null;

  return (
    <div style={{ background:C.bg1, border:`1px solid ${C.borderCyan}`, borderRadius:'16px', padding:'20px', marginBottom:'14px' }}>
      <div style={{ fontSize:'13px', fontWeight:'700', color:C.cyanLight, marginBottom:'18px' }}>🔔 Reminder Settings</div>

      <Toggle value={emailEnabled} onChange={setEmailEnabled} label="📧 Email Reminders" sub={`Reminders sent to ${userEmail}`} />

      <div style={{ background:`${C.orange}10`, border:`1px solid ${C.orange}22`, borderRadius:'12px', padding:'14px', margin:'14px 0' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
          <div>
            <div style={{ fontSize:'13px', fontWeight:'600', color:C.text }}>📱 WhatsApp Reminders</div>
            <div style={{ fontSize:'11px', color:C.orange, marginTop:'2px' }}>Automatic WhatsApp alerts — launching soon</div>
          </div>
          <div style={{ background:`${C.orange}20`, border:`1px solid ${C.orange}33`, color:C.orange, padding:'4px 12px', borderRadius:'20px', fontSize:'11px', fontWeight:'700', flexShrink:0 }}>Coming Soon</div>
        </div>
        <label style={{ display:'block', color:C.textMuted, marginBottom:'6px', fontSize:'11px', letterSpacing:'1px', fontWeight:'600' }}>YOUR WHATSAPP NUMBER</label>
        <div style={{ display:'flex', gap:'8px' }}>
          <div style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'12px 14px', color:C.textMuted, fontSize:'14px', flexShrink:0 }}>🇮🇳 +91</div>
          <input value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g,'').slice(0,10))} placeholder="Save your number for when it launches" style={{ ...inp(), flex:1 }} />
        </div>
        <div style={{ fontSize:'11px', color:C.textDim, marginTop:'5px' }}>Save now — we'll activate WhatsApp reminders as soon as it launches.</div>
      </div>

      <div style={{ marginBottom:'14px' }}>
        <div style={{ fontSize:'11px', fontWeight:'700', color:C.textMuted, letterSpacing:'1px', marginBottom:'4px' }}>WHEN TO REMIND ME</div>
        <Toggle value={remind7} onChange={setRemind7} label="7 days before deadline" sub="Plenty of time to prepare" />
        <Toggle value={remind3} onChange={setRemind3} label="3 days before deadline" sub="Time to take action" />
        <Toggle value={remind1} onChange={setRemind1} label="1 day before deadline" sub="Last chance warning" />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'11px 0' }}>
          <div>
            <div style={{ fontSize:'13px', fontWeight:'600', color:C.text }}>On the day itself</div>
            <div style={{ fontSize:'11px', color:C.textMuted, marginTop:'2px' }}>Morning reminder on the due date</div>
          </div>
          <div onClick={()=>setRemindDay(!remindDay)} style={{ width:'44px', height:'24px', borderRadius:'12px', background:remindDay?`linear-gradient(135deg,#0e7490,${C.cyan})`:C.bg2, border:`1px solid ${remindDay?C.cyan:C.border}`, cursor:'pointer', position:'relative', transition:'all .2s', flexShrink:0 }}>
            <div style={{ width:'18px', height:'18px', borderRadius:'50%', background:'#fff', position:'absolute', top:'2px', left:remindDay?'22px':'2px', transition:'left .2s', boxShadow:'0 1px 4px rgba(0,0,0,0.3)' }} />
          </div>
        </div>
      </div>

      <div style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'12px 14px', marginBottom:'16px' }}>
        <div style={{ fontSize:'11px', color:C.textMuted, fontWeight:'600', marginBottom:'8px' }}>📅 YOUR UPCOMING REMINDERS FOR GSTR-3B (Apr 20)</div>
        {[remind7&&{label:'7 days before',date:'Apr 13'},remind3&&{label:'3 days before',date:'Apr 17'},remind1&&{label:'1 day before',date:'Apr 19'},remindDay&&{label:'Day of deadline',date:'Apr 20'}].filter(Boolean).map((r,i,arr)=>(
          <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:'12px', padding:'4px 0', borderBottom:i<arr.length-1?`1px solid ${C.border}`:'none' }}>
            <span style={{ color:C.textMuted }}>📅 {r.label}</span>
            <span style={{ color:C.cyan, fontWeight:'600' }}>{r.date}</span>
          </div>
        ))}
        {!remind7&&!remind3&&!remind1&&!remindDay&&<div style={{ fontSize:'12px', color:C.red, textAlign:'center', padding:'8px 0' }}>⚠️ No reminders set — you might miss a deadline!</div>}
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:'14px' }}>
        <button onClick={saveSettings} disabled={saving} style={{ ...btnC, opacity:saving?.7:1 }}>
          {saving?'⏳ Saving...':'🔔 Save Reminder Settings'}
        </button>
        {saved && <span style={{ color:C.green, fontSize:'14px', fontWeight:'700' }}>✅ Saved!</span>}
      </div>
    </div>
  );
}

// ── NOTICE HISTORY ────────────────────────────────────────────────────────
function NoticeHistory({ notices }) {
  if (!notices || notices.length === 0) return (
    <div style={card()}>
      <div style={{ fontSize:'13px', fontWeight:'700', color:C.cyanLight, marginBottom:'12px' }}>📋 Notice History</div>
      <div style={{ fontSize:'13px', color:C.textMuted, textAlign:'center', padding:'20px 0' }}>
        No resolved notices yet.<br/>
        <span style={{ fontSize:'12px' }}>Use "Mark as Resolved" in the Notice tab to track them here.</span>
      </div>
    </div>
  );
  return (
    <div style={card()}>
      <div style={{ fontSize:'13px', fontWeight:'700', color:C.cyanLight, marginBottom:'14px' }}>📋 Notice History</div>
      {notices.slice(0, 10).map((n, i) => (
        <div key={n.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:i<Math.min(notices.length,10)-1?`1px solid ${C.border}`:'none' }}>
          <div>
            <div style={{ fontSize:'13px', fontWeight:'700', color:C.text }}>{n.notice_type}</div>
            <div style={{ fontSize:'11px', color:C.textMuted, marginTop:'2px' }}>{n.period} • Resolved {n.resolved_on}</div>
          </div>
          <div style={{ background:n.risk_level==='HIGH'?`${C.red}15`:n.risk_level==='MEDIUM'?`${C.orange}15`:`${C.cyan}15`, border:`1px solid ${n.risk_level==='HIGH'?C.red:n.risk_level==='MEDIUM'?C.orange:C.cyan}33`, color:n.risk_level==='HIGH'?C.red:n.risk_level==='MEDIUM'?C.orange:C.cyan, padding:'4px 12px', borderRadius:'20px', fontSize:'11px', fontWeight:'700', flexShrink:0 }}>
            ✅ {n.risk_level}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── INVOICE UPLOADER ──────────────────────────────────────────────────────
function InvoiceUploader({ noticeResult }) {
  const [files, setFiles] = useState([]);
  const [merging, setMerging] = useState(false);
  const [instrBusy, setInstrBusy] = useState(false);
  const fileRef = useRef(null);

  function addFiles(picked) {
    const valid = Array.from(picked).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...valid.filter(f => !names.has(f.name))];
    });
  }

  function removeFile(i) { setFiles(p => p.filter((_, idx) => idx !== i)); }

  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }

  async function toDataUrl(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = e => res(e.target.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  async function imgToJpeg(dataUrl) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const cvs = document.createElement('canvas');
        cvs.width = img.width; cvs.height = img.height;
        const ctx = cvs.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cvs.width, cvs.height);
        ctx.drawImage(img, 0, 0);
        res({ jpeg: cvs.toDataURL('image/jpeg', 0.88), w: img.width, h: img.height });
      };
      img.onerror = rej;
      img.src = dataUrl;
    });
  }

  async function pdfToJpegs(file) {
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) return [];
    try {
      const ab = await file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: ab }).promise;
      const out = [];
      for (let pg = 1; pg <= pdfDoc.numPages; pg++) {
        const page = await pdfDoc.getPage(pg);
        const vp = page.getViewport({ scale: 2 });
        const cvs = document.createElement('canvas');
        cvs.width = vp.width; cvs.height = vp.height;
        await page.render({ canvasContext: cvs.getContext('2d'), viewport: vp }).promise;
        out.push({ jpeg: cvs.toDataURL('image/jpeg', 0.85), w: vp.width, h: vp.height });
      }
      return out;
    } catch { return []; }
  }

  async function mergeAndDownload() {
    if (!files.length) return;
    setMerging(true);
    try {
      const doc = new jsPDF({ unit: 'px', format: 'a4', compress: true });
      const PW = doc.internal.pageSize.getWidth();
      let first = true;

      for (const file of files) {
        let pages = [];
        if (file.type.startsWith('image/')) {
          const dataUrl = await toDataUrl(file);
          const { jpeg, w, h } = await imgToJpeg(dataUrl);
          pages = [{ jpeg, w, h }];
        } else if (file.type === 'application/pdf') {
          pages = await pdfToJpegs(file);
          if (!pages.length) {
            if (!first) doc.addPage();
            const PH = doc.internal.pageSize.getHeight();
            doc.setFontSize(14);
            doc.setTextColor(100, 100, 100);
            doc.text(file.name, PW / 2, PH / 2, { align: 'center' });
            doc.setFontSize(11);
            doc.text('(offline - PDF could not be rendered)', PW / 2, PH / 2 + 20, { align: 'center' });
            first = false;
            continue;
          }
        }
        for (const { jpeg, w, h } of pages) {
          if (!first) doc.addPage();
          doc.addImage(jpeg, 'JPEG', 0, 0, PW, (h / w) * PW);
          first = false;
        }
      }
      doc.save('invoices_merged.pdf');
    } catch (e) { alert('Merge failed: ' + e.message); }
    setMerging(false);
  }

  async function downloadReplyCard() {
    if (!noticeResult) return;
    setInstrBusy(true);
    try {
      // Generate a draft reply letter using Claude
      let draftReply = '';
      if (CLAUDE_KEY) {
        try {
          const draftPrompt = `You are a senior Indian CA. Write a formal GST notice reply letter for a small business owner.

Notice details:
- Type: ${noticeResult.type}
- Section: ${noticeResult.section}
- What department wants: ${noticeResult.want}
- Urgency: ${noticeResult.urgency}

Write a professional reply letter they can copy-paste and send. Include:
1. Proper salutation (To: The Jurisdictional GST Officer)
2. Subject line with notice type and section
3. Body: politely acknowledge the notice, state GSTIN, state your position, request relief or provide explanation
4. Closing with "Yours faithfully" and space for signature

Keep it under 200 words. Write in formal English. Use [YOUR NAME], [YOUR GSTIN], [DIN NUMBER], [NOTICE DATE] as placeholders where needed.`;
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
            body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: draftPrompt }] }),
          });
          const d = await res.json();
          if (d.content && d.content[0]) draftReply = d.content[0].text;
        } catch (e) { draftReply = ''; }
      }

      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const rC = noticeResult.risk === 'HIGH' ? [239, 68, 68] : noticeResult.risk === 'MEDIUM' ? [249, 115, 22] : [34, 211, 238];

      const addPageBg = () => { doc.setFillColor(252, 252, 253); doc.rect(0, 0, W, H, 'F'); };
      const checkPage = (neededY) => {
        if (neededY > H - 60) { doc.addPage(); addPageBg(); return 40; }
        return neededY;
      };

      addPageBg();

      // ── PAGE 1: HEADER ──
      doc.setFillColor(...rC);
      doc.rect(0, 0, W, 6, 'F');
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 6, W, 72, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(255, 255, 255);
      doc.text('GST Notice Action Plan', 28, 38);
      doc.setFontSize(9);
      doc.setTextColor(...rC);
      doc.text(`${noticeResult.risk} RISK  ·  ${noticeResult.type}  ·  ${noticeResult.section}`, 28, 56);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated by Taxpe  ·  ${new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })}`, 28, 70);

      let y = 102;

      // ── QUICK SUMMARY BOX ──
      doc.setFillColor(240, 249, 255);
      doc.setDrawColor(...rC);
      doc.setLineWidth(0.5);
      doc.roundedRect(24, y, W - 48, 14, 3, 3, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...rC);
      doc.text('NOTICE SUMMARY', 32, y + 9.5);
      y += 18;

      // What they want
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(24, y, W - 48, 44, 4, 4, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text('WHAT THE DEPARTMENT WANTS', 32, y + 12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      const wantLines = doc.splitTextToSize(noticeResult.want, W - 80);
      doc.text(wantLines, 32, y + 26);
      y += 54;

      // Urgency
      doc.setFillColor(255, 247, 237);
      doc.setDrawColor(249, 115, 22);
      doc.roundedRect(24, y, W - 48, 44, 4, 4, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(249, 115, 22);
      doc.text('⚠  DEADLINE & URGENCY', 32, y + 12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(124, 45, 18);
      const urgLines = doc.splitTextToSize(noticeResult.urgency, W - 80);
      doc.text(urgLines, 32, y + 26);
      y += 54;

      // If ignored
      doc.setFillColor(254, 242, 242);
      doc.setDrawColor(239, 68, 68);
      doc.roundedRect(24, y, W - 48, 44, 4, 4, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(239, 68, 68);
      doc.text('✕  IF YOU IGNORE THIS', 32, y + 12);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      doc.setTextColor(127, 29, 29);
      const ignLines = doc.splitTextToSize(noticeResult.ignored, W - 80);
      doc.text(ignLines, 32, y + 26);
      y += 60;

      // ── STEP BY STEP ──
      doc.setFillColor(240, 249, 255);
      doc.setDrawColor(...rC);
      doc.roundedRect(24, y, W - 48, 14, 3, 3, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...rC);
      doc.text('EXACT STEPS TO REPLY', 32, y + 9.5);
      y += 20;

      for (let si = 0; si < noticeResult.steps.length; si++) {
        const stepLines = doc.splitTextToSize(noticeResult.steps[si], W - 100);
        const boxH = stepLines.length * 13 + 20;
        y = checkPage(y + boxH);

        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(24, y - boxH + 4, W - 48, boxH, 4, 4, 'FD');

        // Step number circle
        doc.setFillColor(...rC);
        doc.circle(40, y - boxH + 4 + boxH / 2, 9, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(255, 255, 255);
        doc.text(String(si + 1), 40, y - boxH + 4 + boxH / 2 + 3.5, { align: 'center' });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10.5);
        doc.setTextColor(30, 41, 59);
        doc.text(stepLines, 58, y - boxH + 16);
        y += 8;
      }

      y += 12;
      y = checkPage(y + 60);

      // ── GST PORTAL LINK ──
      doc.setFillColor(240, 249, 255);
      doc.setDrawColor(34, 211, 238);
      doc.roundedRect(24, y, W - 48, 52, 6, 6, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(14, 116, 144);
      doc.text('SUBMIT YOUR REPLY HERE', 32, y + 14);
      doc.setFontSize(10.5);
      doc.setTextColor(7, 89, 133);
      doc.text('https://services.gst.gov.in', 32, y + 30);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text('Login  →  Services  →  View Notices & Orders  →  Find your notice  →  Click Reply', 32, y + 44);
      y += 64;

      // ── PAGE 2: DRAFT REPLY LETTER ──
      if (draftReply) {
        doc.addPage();
        addPageBg();
        doc.setFillColor(...rC);
        doc.rect(0, 0, W, 6, 'F');

        let ly = 36;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(15, 23, 42);
        doc.text('Draft Reply Letter', 28, ly);
        ly += 10;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(100, 116, 139);
        doc.text('Fill in the [ ] placeholders and submit on GST portal or send to your officer.', 28, ly + 8);
        ly += 26;

        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(24, ly, W - 48, H - ly - 50, 6, 6, 'FD');

        ly += 16;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        const letterLines = doc.splitTextToSize(draftReply, W - 80);
        for (const line of letterLines) {
          if (ly > H - 70) { doc.addPage(); addPageBg(); ly = 36; }
          doc.text(line, 36, ly);
          ly += 14;
        }
      }

      // Footer on every page
      const totalPages = doc.internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFillColor(15, 23, 42);
        doc.rect(0, H - 22, W, 22, 'F');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text('Taxpe  ·  Don\'t get fined.  ·  taxpe-web.vercel.app', W / 2, H - 8, { align: 'center' });
        doc.text(`Page ${p} of ${totalPages}`, W - 28, H - 8, { align: 'right' });
      }

      doc.save('taxpe_gst_reply_plan.pdf');
    } catch (e) { alert('PDF error: ' + e.message); }
    setInstrBusy(false);
  }

  return (
    <div style={{ marginTop: '20px' }}>
      {/* ── Invoice Upload & Merge ── */}
      <div style={{ background: C.bg1, border: `1px solid ${C.borderCyan}`, borderRadius: '16px', padding: '20px', marginBottom: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: C.cyanLight, marginBottom: '4px' }}>📎 Attach Invoice Documents</div>
        <div style={{ fontSize: '12px', color: C.textMuted, marginBottom: '16px', lineHeight: '1.6' }}>
          Upload invoice images or PDFs to include with your notice reply. All files will be merged into one downloadable PDF.
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${C.cyan}44`,
            borderRadius: '12px',
            padding: '28px 16px',
            textAlign: 'center',
            cursor: 'pointer',
            background: '#031a2020',
            marginBottom: '14px',
            transition: 'border-color .2s',
          }}
        >
          <div style={{ fontSize: '26px', marginBottom: '6px' }}>📁</div>
          <div style={{ fontSize: '13px', color: C.cyan, fontWeight: '700' }}>Click to select or drag & drop</div>
          <div style={{ fontSize: '11px', color: C.textMuted, marginTop: '4px' }}>JPG · PNG · WEBP · PDF — multiple files OK</div>
        </div>
        <input ref={fileRef} type="file" multiple accept="image/*,.pdf" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />

        {/* File list */}
        {files.length > 0 && (
          <div style={{ marginBottom: '14px' }}>
            {files.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', background: C.bg2, borderRadius: '10px', marginBottom: '6px', border: `1px solid ${C.border}` }}>
                <span style={{ fontSize: '18px', flexShrink: 0 }}>{f.type === 'application/pdf' ? '📄' : '🖼️'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', color: C.text, fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                  <div style={{ fontSize: '11px', color: C.textMuted }}>{fmtSize(f.size)}</div>
                </div>
                <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* Merge & Download button */}
        <button
          onClick={mergeAndDownload}
          disabled={!files.length || merging}
          style={{ ...btnC, width: '100%', padding: '13px', opacity: !files.length || merging ? 0.5 : 1 }}
        >
          {merging
            ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                Merging... {[0,1,2].map(j => <span key={j} className={`dot-${j+1}`} style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#000', display: 'inline-block' }} />)}
              </span>
            : files.length > 0
              ? `📥 Download Merged PDF (${files.length} file${files.length > 1 ? 's' : ''})`
              : 'Add files above to merge'}
        </button>
      </div>

      {/* ── Reply Instruction Card ── */}
      <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '20px', marginBottom: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: C.cyanLight, marginBottom: '4px' }}>📋 Reply Instruction Card</div>
        <div style={{ fontSize: '12px', color: C.textMuted, marginBottom: '14px', lineHeight: '1.6' }}>
          2-page PDF: exact reply steps for your notice + a ready-to-send draft reply letter. Hand it to your CA or submit yourself.
        </div>

        {/* What dept wants */}
        <div style={{ background: '#0d1f2d', border: `1px solid ${C.cyan}33`, borderRadius: '10px', padding: '12px 14px', marginBottom: '10px' }}>
          <div style={{ fontSize: '10px', fontWeight: '700', color: C.cyanDim, letterSpacing: '0.8px', marginBottom: '5px' }}>WHAT THEY WANT</div>
          <div style={{ fontSize: '13px', color: C.text, fontWeight: '600', lineHeight: '1.5' }}>{noticeResult.want}</div>
        </div>

        {/* Urgency */}
        <div style={{ background: '#1c0a00', border: `1px solid ${C.orange}33`, borderRadius: '10px', padding: '12px 14px', marginBottom: '10px' }}>
          <div style={{ fontSize: '10px', fontWeight: '700', color: C.orange, letterSpacing: '0.8px', marginBottom: '5px' }}>⚠ DEADLINE</div>
          <div style={{ fontSize: '13px', color: '#fdba74', fontWeight: '600', lineHeight: '1.5' }}>{noticeResult.urgency}</div>
        </div>

        {/* If ignored */}
        <div style={{ background: C.redDim, border: `1px solid ${C.red}33`, borderRadius: '10px', padding: '12px 14px', marginBottom: '14px' }}>
          <div style={{ fontSize: '10px', fontWeight: '700', color: C.red, letterSpacing: '0.8px', marginBottom: '5px' }}>✕ IF YOU IGNORE</div>
          <div style={{ fontSize: '13px', color: '#fca5a5', fontWeight: '600', lineHeight: '1.5' }}>{noticeResult.ignored}</div>
        </div>

        {/* PDF contents preview */}
        <div style={{ background: C.bg2, borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: '10px', fontWeight: '700', color: C.textMuted, letterSpacing: '0.8px', marginBottom: '8px' }}>PDF INCLUDES</div>
          {[
            ['Page 1', `${noticeResult.steps.length} specific reply steps for ${noticeResult.type}`],
            ['Page 1', 'Direct GST portal link — where to click to reply'],
            ['Page 2', 'AI-drafted reply letter — fill your name & submit'],
          ].map(([badge, text], i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '5px 0', borderBottom: i < 2 ? `1px solid ${C.border}` : 'none' }}>
              <span style={{ background: `${C.cyan}18`, color: C.cyan, fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '6px', whiteSpace: 'nowrap', marginTop: '1px' }}>{badge}</span>
              <span style={{ fontSize: '12px', color: C.textMuted }}>{text}</span>
            </div>
          ))}
        </div>

        <button
          onClick={downloadReplyCard}
          disabled={instrBusy}
          style={{ ...btnG, width: '100%', padding: '13px', fontSize: '14px', opacity: instrBusy ? 0.6 : 1 }}
        >
          {instrBusy ? '⏳ Generating PDF + Draft Letter...' : '📄 Download Reply Instruction Card'}
        </button>
      </div>
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [tab, setTab] = useState('dashboard');
  const [isPremium, setIsPremium] = useState(false);
  const [questionsUsed, setQuestionsUsed] = useState(0);
  const [bizName, setBizName] = useState('');
  const [gstin, setGstin] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gstinStatus, setGstinStatus] = useState(null);

  const [filings, setFilings] = useState([]);
  const [filingStreak, setFilingStreak] = useState(0);
  const [penaltySaved, setPenaltySaved] = useState(0);
  const [filedThisMonth, setFiledThisMonth] = useState(new Set());

  const [resolvedNotices, setResolvedNotices] = useState([]);
  const [noticeResolved, setNoticeResolved] = useState(false);
  const [resolvingNotice, setResolvingNotice] = useState(false);

  const [taxpayerType, setTaxpayerType] = useState('regular');

  const [upgradeModal, setUpgradeModal] = useState(null);
  const [expandedDeadline, setExpandedDeadline] = useState(null);
  const [noticeDecodes, setNoticeDecodes] = useState(0);

  const [chatMode, setChatMode] = useState('entry');
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [aiConnected] = useState(!!CLAUDE_KEY);

  const [noticeText, setNoticeText] = useState('');
  const [noticeResult, setNoticeResult] = useState(null);
  const [decoding, setDecoding] = useState(false);

  const chatEndRef = useRef(null);
const DEADLINE_FILTER = {
  regular:     ['GSTR-1', 'GSTR-3B', 'TDS', 'ITR'],
  composition: ['GSTR-4', 'CMP-08', 'ITR'],
  quarterly:   ['GSTR-1Q', 'GSTR-3BQ', 'TDS', 'ITR'],
};
  const deadlines = DEADLINES.map(d => ({ ...d, ...getStatus(d.date) }));
const activeDeadlines = deadlines.filter(d => (DEADLINE_FILTER[taxpayerType] || DEADLINE_FILTER['regular']).includes(d.name));
const overdue = activeDeadlines.filter(d => d.days < 0);
  const dueSoon = activeDeadlines.filter(d => d.days >= 0 && d.days <= 7);
  const mostUrgent = [...activeDeadlines].sort((a,b) => a.days - b.days)[0];
  const FREE_Q = 3;
  const qLeft = Math.max(0, FREE_Q - questionsUsed);

  const loadFilings = useCallback(async (uid) => {
    const { data, error } = await supabase.from('filings').select('*').eq('user_id',uid).order('filed_on',{ ascending:false });
    if (!error && data) {
      setFilings(data);
      setFilingStreak(calculateStreak(data));
      setPenaltySaved(calculatePenaltySaved(data));
      const now = new Date();
      const thisMonth = new Set();
      data.forEach(f => { const d = new Date(f.filed_on); if (d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()) thisMonth.add(f.return_type); });
      setFiledThisMonth(thisMonth);
    }
  }, []);

  const loadNotices = useCallback(async (uid) => {
    const { data, error } = await supabase.from('notices').select('*').eq('user_id', uid).order('resolved_on', { ascending: false });
    if (!error && data) setResolvedNotices(data);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data:{ session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
      if (session?.user) { loadProfile(session.user.id); loadFilings(session.user.id); loadNotices(session.user.id); }
    });
    const { data:{ subscription } } = supabase.auth.onAuthStateChange((_,session) => {
      setUser(session?.user ?? null);
      if (session?.user) { loadProfile(session.user.id); loadFilings(session.user.id); loadNotices(session.user.id); }
    });
    return () => subscription.unsubscribe();
  }, [loadFilings, loadNotices]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:'smooth' }); }, [messages]);

  async function loadProfile(uid) {
    const { data } = await supabase.from('profiles').select('*').eq('id',uid).single();
    if (data) { setBizName(data.business_name||''); setGstin(data.gstin||''); setIsPremium(data.is_premium||false); setQuestionsUsed(data.questions_this_month||0); setTaxpayerType(data.taxpayer_type||'regular'); }
  }

  function handleFiled(returnType, wasOnTime) {
    setFiledThisMonth(prev => new Set([...prev, returnType]));
    if (wasOnTime) { const dl = DEADLINES.find(d => d.name === returnType); if (dl && dl.penalty > 0) setPenaltySaved(prev => prev + dl.penalty * 30); }
    if (user) setTimeout(() => loadFilings(user.id), 1000);
  }

  async function handleResolveNotice() {
    if (!user || !noticeResult || noticeResolved) return;
    setResolvingNotice(true);
    const period = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
    const resolved_on = new Date().toISOString().split('T')[0];
    const { error } = await supabase.from('notices').insert({
      user_id: user.id,
      notice_type: noticeResult.type,
      risk_level: noticeResult.risk,
      resolved_on,
      period,
    });
    if (!error) {
      setNoticeResolved(true);
      setResolvedNotices(prev => [{ id: Date.now(), notice_type: noticeResult.type, risk_level: noticeResult.risk, resolved_on, period }, ...prev]);
    }
    setResolvingNotice(false);
  }

  async function handleAuth() {
    setAuthError(''); setAuthBusy(true);
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user) await supabase.from('profiles').insert({ id:data.user.id, email, business_name:'', gstin:'', is_premium:false, questions_this_month:0 });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch(e) { setAuthError(e.message); }
    setAuthBusy(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setUser(null); setBizName(''); setGstin('');
    setChatMode('entry'); setMessages([]);
    setFilings([]); setFilingStreak(0); setPenaltySaved(0);
  }

  function startChat(situation) {
    setChatMode('active');
    const q = situation==='notice'?'I received a GST notice. What should I do?':situation==='deadline'?'I have a filing deadline coming up. What do I need to do?':'I have a general tax question about my business.';
    setMessages([{ role:'user', text:q }]);
    setChatBusy(true);
    const context = gstin ? `User GSTIN: ${gstin}, Business: ${bizName}` : '';
    askClaude(q, context).then(answer => {
      setMessages([{ role:'user', text:q },{ role:'assistant', text:answer||getFallbackAnswer(q), showEscalate:true }]);
      setChatBusy(false);
    });
  }

  async function sendChat(text) {
    const q = text || chatInput;
    if (!q.trim()) return;
    if (!isPremium && qLeft <= 0) { setUpgradeModal('questions'); return; }
    setMessages(p => [...p, { role:'user', text:q }]);
    setChatInput(''); setChatBusy(true);
    const context = gstin ? `User GSTIN: ${gstin}, Business: ${bizName}` : '';
    const newUsed = questionsUsed + 1;
    const answer = await askClaude(q, context) || getFallbackAnswer(q);
    setMessages(p => [...p, { role:'assistant', text:answer, showEscalate:true }]);
    setChatBusy(false);
    setQuestionsUsed(newUsed);
    if (!isPremium && newUsed >= FREE_Q) setTimeout(() => setUpgradeModal('questions'), 1200);
    if (user) {
      await supabase.from('chat_history').insert({ user_id:user.id, question:q, answer, category:'general' });
      await supabase.from('profiles').update({ questions_this_month:newUsed }).eq('id',user.id);
    }
  }

  async function decodeNotice() {
    if (!noticeText.trim()) return;
    if (!isPremium && noticeDecodes >= 2) { setUpgradeModal('notice'); return; }
    setDecoding(true);
    let result = await decodeWithClaude(noticeText);
    if (!result) {
      const l = noticeText.toLowerCase();
      if (l.includes('show cause')||l.includes('cause')) result = { type:'Show Cause Notice', risk:'HIGH', section:'Section 73/74 — CGST Act', want:'Explanation why penalty should not be imposed', urgency:'Reply within 30 days or face ex-parte order', ignored:'Demand confirmed + 18% interest', steps:['Do not panic','Check GSTR-2A','Gather invoices','GST portal → View Notices → Reply','Submit before deadline'] };
      else if (l.includes('demand')||l.includes('drc')) result = { type:'Demand Notice (DRC-01)', risk:'HIGH', section:'Section 73 — CGST Act', want:'Payment of outstanding tax demand', urgency:'Pay or appeal within 3 months', ignored:'Bank account attachment possible', steps:['Verify demand on GST portal','Match with filed returns','If correct: pay via DRC-03','If wrong: file appeal APL-01','Attach supporting invoices'] };
      else result = { type:'General GST Notice', risk:'LOW', section:'CGST Act', want:'Clarification or information', urgency:'Check notice for deadline', ignored:'Escalation to show cause', steps:['Note reference number','GST portal → View Notices','Gather documents','Reply before deadline','Keep copy of reply'] };
    }
    setNoticeResult(result);
    setNoticeDecodes(p => p+1);
    setDecoding(false);
  }

  async function saveProfile() {
    if (!user) return;
    setSaving(true);
    await supabase.from('profiles').update({ business_name:bizName, gstin }).eq('id',user.id);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleGSTINDetect() {
    const pattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!pattern.test(gstin)) { setGstinStatus('error'); return; }
    setGstinStatus('loading');
    try {
      const res = await fetch(`https://sheet.gst.gov.in/api/commonhome/searchpayer/${gstin}`, { headers:{ 'Content-Type':'application/json' } });
      const data = await res.json();
      const dty = (data?.data?.dty || '').toLowerCase();
      const taxpayerType = dty.includes('composition') ? 'composition' : 'regular';
      await supabase.from('profiles').update({ taxpayer_type: taxpayerType }).eq('id', user.id);
      setGstinStatus({ name: data?.data?.lgnm || bizName, type: taxpayerType });
    } catch { setGstinStatus('error'); }
  }

  const tabs = [
    { id:'dashboard', icon:'🏠', name:'Home' },
    { id:'deadlines', icon:'⏰', name:'Deadlines' },
    { id:'chat', icon:'💬', name:'Ask' },
    { id:'notice', icon:'📄', name:'Notice' },
    { id:'profile', icon:'👤', name:'Profile' },
  ];

  if (authLoading) return (
    <div style={{ minHeight:'100vh', background:C.bg0, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:'24px' }}>
      <div className="cyan-shimmer" style={{ fontSize:'42px', fontWeight:'900' }}>⚡ Taxpe</div>
      <div style={{ display:'flex', gap:'8px' }}>{[0,1,2].map(i=><div key={i} className={`dot-${i+1}`} style={{ width:'8px', height:'8px', borderRadius:'50%', background:C.cyan }} />)}</div>
    </div>
  );

  if (!user) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:'20px', position:'relative', overflow:'hidden', background:`radial-gradient(ellipse at 25% 25%, #031a2055, transparent 55%), ${C.bg0}` }}>
      <div className="orb" style={{ width:'350px', height:'350px', background:'#22d3ee08', top:'-120px', right:'-120px', animation:'float 10s ease-in-out infinite' }} />
      <div style={{ width:'100%', maxWidth:'420px', position:'relative', zIndex:1, animation:'fadeUp .6s ease' }}>
        <div style={{ textAlign:'center', marginBottom:'36px' }}>
          <div className="cyan-shimmer" style={{ fontSize:'52px', fontWeight:'900', letterSpacing:'-2px', marginBottom:'12px' }}>⚡ Taxpe</div>
          <div style={{ fontSize:'22px', fontWeight:'900', color:'#fff', marginBottom:'8px' }}>Don't get fined.</div>
          <div style={{ color:C.textMuted, fontSize:'14px', lineHeight:'1.7' }}>Track deadlines. File on time. Never pay avoidable fines.</div>
          {aiConnected && <div style={{ marginTop:'10px', display:'inline-block', background:`${C.green}15`, border:`1px solid ${C.green}33`, color:C.green, padding:'4px 14px', borderRadius:'20px', fontSize:'12px', fontWeight:'600' }}>⚡ AI-Powered by Claude</div>}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px', marginBottom:'24px' }}>
          {[['₹50/day','Late GSTR-3B'],['₹200/day','Late TDS'],['₹10,000+','Ignored notice']].map(([v,k])=>(
            <div key={k} style={{ background:'#1a0505', border:`1px solid ${C.red}22`, borderRadius:'10px', padding:'10px', textAlign:'center' }}>
              <div style={{ fontSize:'16px', fontWeight:'900', color:C.red }}>{v}</div>
              <div style={{ fontSize:'10px', color:'#fca5a5', marginTop:'2px' }}>{k}</div>
            </div>
          ))}
        </div>
        <div style={{ background:C.bg1, border:`1px solid ${C.borderCyan}`, borderRadius:'24px', padding:'32px' }}>
          <div style={{ display:'flex', background:C.bg0, borderRadius:'12px', padding:'4px', marginBottom:'26px', border:`1px solid ${C.border}` }}>
            {['login','signup'].map(m=>(
              <button key={m} onClick={()=>{ setAuthMode(m); setAuthError(''); }} style={{ flex:1, padding:'11px', border:'none', borderRadius:'9px', cursor:'pointer', fontWeight:'700', fontSize:'14px', transition:'all .2s', background:authMode===m?`linear-gradient(135deg,#0e7490,${C.cyan})`:'transparent', color:authMode===m?'#000':C.textMuted, fontFamily:'inherit' }}>
                {m==='login'?'🔐 Login':'🚀 Sign Up Free'}
              </button>
            ))}
          </div>
          <div style={{ marginBottom:'14px' }}>
            <label style={{ display:'block', color:C.textMuted, marginBottom:'7px', fontSize:'11px', letterSpacing:'1px', fontWeight:'600' }}>EMAIL ADDRESS</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@business.com" className="inp-field" style={inp()} />
          </div>
          <div style={{ marginBottom:'22px' }}>
            <label style={{ display:'block', color:C.textMuted, marginBottom:'7px', fontSize:'11px', letterSpacing:'1px', fontWeight:'600' }}>PASSWORD</label>
            <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Min 6 characters" className="inp-field" onKeyDown={e=>e.key==='Enter'&&handleAuth()} style={inp()} />
          </div>
          {authError && <div style={{ background:'#ef444415', border:'1px solid #ef444430', color:'#ef4444', padding:'12px', borderRadius:'10px', fontSize:'13px', marginBottom:'16px' }}>⚠️ {authError}</div>}
          <button onClick={handleAuth} disabled={authBusy} className="btn-cyan" style={{ ...btnC, width:'100%', padding:'15px', fontSize:'16px', borderRadius:'12px', opacity:authBusy?.7:1 }}>
            {authBusy?<span style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'8px' }}>Processing {[0,1,2].map(i=><span key={i} className={`dot-${i+1}`} style={{ width:'5px', height:'5px', borderRadius:'50%', background:'#000', display:'inline-block' }} />)}</span>
              :authMode==='login'?'Login → Stop Getting Fined':'Create Account → Protect My Business'}
          </button>
          <div style={{ textAlign:'center', color:C.textDim, fontSize:'13px', marginTop:'16px' }}>
            {authMode==='login'?'New? ':'Have account? '}
            <span onClick={()=>setAuthMode(authMode==='login'?'signup':'login')} style={{ color:C.cyan, cursor:'pointer', fontWeight:'700' }}>{authMode==='login'?'Sign up free →':'Login →'}</span>
          </div>
        </div>
        <div style={{ textAlign:'center', color:C.textDim, fontSize:'12px', marginTop:'20px' }}>
          🆓 Free: 3 questions/day • ⭐ Pro: ₹299/month — never get fined
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:'100vh', background:C.bg0, color:C.text }}>
      {upgradeModal && <UpgradeModal reason={upgradeModal} onClose={()=>setUpgradeModal(null)} isPremium={isPremium} />}

      <div style={{ background:C.bg1, position:'sticky', top:0, zIndex:100, borderBottom:`1px solid ${C.border}` }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 18px' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <div className="cyan-shimmer" style={{ fontSize:'22px', fontWeight:'900', letterSpacing:'-0.5px' }}>⚡ Taxpe</div>
              {aiConnected && <div style={{ background:`${C.green}15`, border:`1px solid ${C.green}22`, color:C.green, padding:'2px 8px', borderRadius:'8px', fontSize:'9px', fontWeight:'700' }}>AI LIVE</div>}
            </div>
            {bizName && <div style={{ fontSize:'11px', color:C.textDim, marginTop:'1px' }}>{bizName}</div>}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            {overdue.length > 0 && <div className="red-pulse" style={{ background:C.redDim, border:`1px solid ${C.red}55`, color:C.red, padding:'5px 12px', borderRadius:'20px', fontSize:'11px', fontWeight:'800', cursor:'pointer' }} onClick={()=>setTab('deadlines')}>{overdue.length} OVERDUE</div>}
            {!isPremium && <div onClick={()=>qLeft===0?setUpgradeModal('questions'):null} style={{ background:qLeft===0?C.redDim:'#031a20', border:`1px solid ${qLeft===0?C.red:C.cyan}33`, color:qLeft===0?C.red:C.cyan, padding:'5px 10px', borderRadius:'20px', fontSize:'10px', fontWeight:'700', cursor:qLeft===0?'pointer':'default' }}>{qLeft===0?'0 Q — Upgrade':`${qLeft}Q`}</div>}
            {isPremium && <div style={{ background:`${C.cyan}15`, border:`1px solid ${C.borderCyan}`, color:C.cyan, padding:'5px 10px', borderRadius:'20px', fontSize:'10px', fontWeight:'700' }}>⭐ PRO</div>}
            {!isPremium && <button onClick={()=>setUpgradeModal('filing')} style={{ background:`linear-gradient(135deg,#0e7490,${C.cyan})`, border:'none', color:'#000', padding:'5px 12px', borderRadius:'8px', cursor:'pointer', fontSize:'11px', fontWeight:'800', fontFamily:'inherit' }}>Get Pro</button>}
            <button onClick={handleLogout} style={{ background:C.bg2, border:`1px solid ${C.border}`, color:C.textMuted, padding:'5px 10px', borderRadius:'8px', cursor:'pointer', fontSize:'11px', fontFamily:'inherit' }}>Out</button>
          </div>
        </div>
        <div className="header-shimmer" />
        <div className="top-tabs" style={{ display:'flex', overflowX:'auto', padding:'0 6px' }}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:'11px 16px', border:'none', background:'transparent', color:tab===t.id?C.cyan:C.textMuted, borderBottom:tab===t.id?`2px solid ${C.cyan}`:'2px solid transparent', cursor:'pointer', fontSize:'13px', whiteSpace:'nowrap', fontWeight:tab===t.id?'700':'500', transition:'color .2s', fontFamily:'inherit' }}>
              {t.icon} {t.name}
            </button>
          ))}
        </div>
      </div>

      <nav className="bottom-nav">
        {tabs.map(t=>(
          <div key={t.id} className="bottom-nav-item" onClick={()=>setTab(t.id)}>
            <div className="bottom-nav-icon">{t.icon}</div>
            <div className="bottom-nav-label" style={{ color:tab===t.id?C.cyan:C.textMuted }}>{t.name}</div>
          </div>
        ))}
      </nav>

      <div className="main-content" style={{ maxWidth:'800px', margin:'0 auto', padding:'22px 16px' }}>
        <div className="tab-content" key={tab}>

        {tab==='dashboard' && <>
          {overdue.length > 0 ? (
            <div className="red-pulse" style={{ background:'linear-gradient(135deg,#1a0505,#2d0a0a)', border:`1px solid ${C.red}55`, borderRadius:'16px', padding:'20px 22px', marginBottom:'18px' }}>
              <div style={{ fontSize:'11px', color:C.red, fontWeight:'800', letterSpacing:'1px', marginBottom:'6px' }}>🔴 YOU ARE LOSING MONEY RIGHT NOW</div>
              <div style={{ fontSize:'24px', fontWeight:'900', color:'#fff', marginBottom:'6px', lineHeight:1.2 }}>{overdue[0].name} is {Math.abs(overdue[0].days)} days overdue</div>
              <div style={{ fontSize:'13px', color:'#fca5a5', marginBottom:'16px' }}>Fine: ₹{(overdue[0].penalty*Math.abs(overdue[0].days)).toLocaleString()} so far. Adding ₹{overdue[0].penalty} every day.</div>
              <div style={{ display:'flex', gap:'10px', flexWrap:'wrap' }}>
                <button onClick={()=>{ setTab('deadlines'); setExpandedDeadline(overdue[0].id); }} style={btnR}>File Now →</button>
                <button onClick={()=>startChat('deadline')} style={{ background:'transparent', border:`1px solid ${C.red}44`, color:'#fca5a5', padding:'12px 18px', borderRadius:'10px', cursor:'pointer', fontSize:'14px', fontFamily:'inherit' }}>Ask AI how to file</button>
              </div>
            </div>
          ) : dueSoon.length > 0 ? (
            <div style={{ background:'linear-gradient(135deg,#1c0a00,#2d1200)', border:`1px solid ${C.orange}55`, borderRadius:'16px', padding:'20px 22px', marginBottom:'18px' }}>
              <div style={{ fontSize:'11px', color:C.orange, fontWeight:'800', letterSpacing:'1px', marginBottom:'6px' }}>⚠️ ACTION REQUIRED — {dueSoon[0].days} DAYS LEFT</div>
              <div style={{ fontSize:'24px', fontWeight:'900', color:'#fff', marginBottom:'6px', lineHeight:1.2 }}>{dueSoon[0].name} due {dueSoon[0].date}</div>
              <div style={{ fontSize:'13px', color:'#fdba74', marginBottom:'16px' }}>Miss this → ₹{dueSoon[0].penalty}/day fine starts automatically.</div>
              <button onClick={()=>{ setTab('deadlines'); setExpandedDeadline(dueSoon[0].id); }} style={btnC}>What do I need to do? →</button>
            </div>
          ) : (
            <div style={{ background:'linear-gradient(135deg,#031a20,#052e20)', border:`1px solid ${C.cyan}33`, borderRadius:'16px', padding:'20px 22px', marginBottom:'18px' }}>
              <div style={{ fontSize:'11px', color:C.cyan, fontWeight:'800', letterSpacing:'1px', marginBottom:'6px' }}>✅ NO IMMEDIATE ACTION NEEDED</div>
              <div style={{ fontSize:'22px', fontWeight:'900', color:'#fff', marginBottom:'6px', lineHeight:1.2 }}>Next: {mostUrgent.name} in {mostUrgent.days} days</div>
              <div style={{ fontSize:'13px', color:C.cyanLight, marginBottom:'14px' }}>Due {mostUrgent.date}. {mostUrgent.penalty>0?`Miss it → ₹${mostUrgent.penalty}/day fine.`:''} Don't relax yet.</div>
              <button onClick={()=>{ setTab('deadlines'); setExpandedDeadline(mostUrgent.id); }} style={{ ...btnC, fontSize:'13px', padding:'10px 18px' }}>See what to do →</button>
            </div>
          )}

          {overdue.length > 0 && overdue[0].penalty > 0 && <PenaltyClock deadline={overdue[0]} />}

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:'10px', marginBottom:'16px' }}>
            {[
              { label:'Penalties Avoided', value:penaltySaved>0?`₹${penaltySaved.toLocaleString()}`:'₹0', color:C.cyan, bg:'#031a20', border:`${C.cyan}22`, sub:'from on-time filings' },
              { label:'Overdue Now', value:overdue.length, color:overdue.length>0?C.red:C.cyan, bg:overdue.length>0?C.redDim:'#031a20', border:`${overdue.length>0?C.red:C.cyan}22`, sub:overdue.length>0?'act now':'all clear' },
              { label:'Due in 7 days', value:dueSoon.length, color:dueSoon.length>0?C.orange:C.textMuted, bg:dueSoon.length>0?C.orangeDim:C.bg1, border:`${dueSoon.length>0?C.orange:C.border}`, sub:'take action' },
              { label:'Filing Streak', value:filingStreak>0?`${filingStreak} 🔥`:'0', color:filingStreak>0?C.yellow:C.textMuted, bg:filingStreak>0?'#1c1500':C.bg1, border:`${filingStreak>0?C.yellow:C.border}`, sub:'months on time' },
            ].map((c,i)=>(
              <div key={i} style={{ background:c.bg, border:`1px solid ${c.border}`, borderRadius:'14px', padding:'16px', textAlign:'center', animation:`fadeUp .4s ease ${i*.07}s both` }}>
                <div style={{ fontSize:'26px', fontWeight:'900', color:c.color, lineHeight:1 }}>{c.value}</div>
                <div style={{ fontSize:'11px', color:C.textMuted, marginTop:'5px', fontWeight:'500' }}>{c.label}</div>
                <div style={{ fontSize:'10px', color:C.textDim, marginTop:'2px' }}>{c.sub}</div>
              </div>
            ))}
          </div>

          <div style={cardC()}>
            <div style={{ fontSize:'13px', fontWeight:'700', color:C.cyanLight, marginBottom:'14px' }}>⏰ Every Deadline — Miss It and It Costs You</div>
            {deadlines.map((d,i)=>(
              <div key={d.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'12px 0', borderBottom:i<deadlines.length-1?`1px solid ${C.border}`:'none', cursor:'pointer' }} onClick={()=>{ setTab('deadlines'); setExpandedDeadline(d.id); }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'3px', flexWrap:'wrap' }}>
                    <span style={{ fontWeight:'800', color:C.text, fontSize:'14px' }}>{d.name}</span>
                    {filedThisMonth.has(d.name) && <span style={{ background:`${C.green}15`, color:C.green, fontSize:'10px', fontWeight:'700', padding:'2px 8px', borderRadius:'8px', border:`1px solid ${C.green}33` }}>✅ Filed</span>}
                    <span style={{ background:d.bg, color:d.color, padding:'2px 10px', borderRadius:'10px', fontSize:'11px', fontWeight:'800', border:`1px solid ${d.border}` }}>{d.days<0?'OVERDUE':d.label}</span>
                  </div>
                  <div style={{ fontSize:'12px', color:C.textMuted }}>{d.desc} • {d.date}</div>
                  {d.penalty>0 && <div style={{ fontSize:'11px', color:d.days<=7?C.red:C.textDim, marginTop:'2px' }}>Miss → ₹{d.penalty}/day</div>}
                </div>
                <div style={{ color:C.textDim, fontSize:'14px', marginLeft:'10px' }}>→</div>
              </div>
            ))}
          </div>

          {!isPremium && (
            <div style={{ background:`${C.orange}12`, border:`1px solid ${C.orange}33`, borderRadius:'14px', padding:'18px 20px' }}>
              <div style={{ fontSize:'13px', fontWeight:'800', color:C.orange, marginBottom:'8px' }}>⚠️ Free plan — what can still go wrong</div>
              {['1 email reminder only. Miss it → fine starts. WhatsApp reminders coming soon.','Filing step-by-step guides are locked. You see the deadline, not how to file.','Notice reply steps are locked. You know the risk, not the fix.'].map((w,i)=>(
                <div key={i} style={{ display:'flex', gap:'10px', padding:'7px 0', borderBottom:i<2?`1px solid ${C.border}`:'none', fontSize:'13px', color:'#fdba74', alignItems:'flex-start' }}>
                  <span style={{ color:C.orange, flexShrink:0 }}>→</span>{w}
                </div>
              ))}
              <button onClick={()=>setUpgradeModal('filing')} style={{ ...btnC, marginTop:'14px', fontSize:'13px', padding:'10px 20px' }}>Fix this with Pro →</button>
            </div>
          )}
        </>}

        {tab==='deadlines' && <>
          <h2 style={{ fontSize:'20px', fontWeight:'800', color:C.text, marginBottom:'6px' }}>⏰ Your Filing Deadlines</h2>
          <div style={{ fontSize:'13px', color:C.textMuted, marginBottom:'20px' }}>Click any deadline. File it. Mark it done. Build your streak.</div>
          {!isPremium && (
            <div style={{ background:`${C.orange}12`, border:`1px solid ${C.orange}33`, borderRadius:'12px', padding:'12px 16px', marginBottom:'16px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'10px' }}>
              <div style={{ fontSize:'13px', color:C.orange, fontWeight:'600' }}>⚠️ Free: You see deadlines but not how to file. Miss one → fine starts.</div>
              <button onClick={()=>setUpgradeModal('filing')} style={{ ...btnC, fontSize:'12px', padding:'7px 14px', whiteSpace:'nowrap' }}>Get Pro →</button>
            </div>
          )}
          <div style={{ display:'flex', flexDirection:'column', gap:'10px', marginBottom:'20px' }}>
            {deadlines.map((d,i)=>(
              <div key={d.id} className="deadline-row" style={{ background:C.bg1, borderLeft:`3px solid ${filedThisMonth.has(d.name)?C.green:d.color}`, borderRadius:'0 14px 14px 0', overflow:'hidden', animationDelay:`${i*.07}s` }}>
                <div style={{ padding:'16px 18px', display:'flex', justifyContent:'space-between', alignItems:'flex-start', cursor:'pointer', gap:'12px' }} onClick={()=>setExpandedDeadline(expandedDeadline===d.id?null:d.id)}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'4px', flexWrap:'wrap' }}>
                      <span style={{ fontSize:'16px', fontWeight:'800', color:C.text }}>{d.name}</span>
                      {filedThisMonth.has(d.name) && <span style={{ background:`${C.green}15`, color:C.green, fontSize:'11px', fontWeight:'700', padding:'2px 10px', borderRadius:'10px', border:`1px solid ${C.green}33` }}>✅ Filed</span>}
                      <span style={{ background:d.bg, color:d.color, padding:'3px 12px', borderRadius:'12px', fontSize:'12px', fontWeight:'800', border:`1px solid ${d.border}` }}>{d.days<0?'⚠️ OVERDUE':d.label+' left'}</span>
                    </div>
                    <div style={{ fontSize:'13px', color:C.textMuted }}>{d.desc} • Due {d.date}</div>
                    <div style={{ fontSize:'12px', color:d.urgent?C.red:C.textDim, marginTop:'4px', fontWeight:d.urgent?'700':'400', lineHeight:'1.5' }}>
                      {d.days<0?`⚠️ Fine: ₹${(d.penalty*Math.abs(d.days)).toLocaleString()} so far`:d.consequence}
                    </div>
                  </div>
                  <div style={{ color:C.textDim, fontSize:'16px', flexShrink:0 }}>{expandedDeadline===d.id?'▲':'▼'}</div>
                </div>
                {expandedDeadline===d.id && (
                  <div style={{ borderTop:`1px solid ${C.border}`, padding:'16px 18px', background:`${C.bg0}cc`, animation:'fadeIn .2s ease' }}>
                    {d.days<0 && d.penalty>0 && <PenaltyClock deadline={d} />}
                    {isPremium ? (
                      <>
                        <div style={{ fontSize:'12px', fontWeight:'700', color:C.cyanLight, marginBottom:'12px' }}>HOW TO FILE — DO THIS NOW:</div>
                        {d.steps.map((step,si)=>(
                          <div key={si} style={{ display:'flex', gap:'12px', padding:'9px 0', borderBottom:si<d.steps.length-1?`1px solid ${C.border}`:'none', alignItems:'flex-start' }}>
                            <div style={{ background:`${C.cyan}18`, color:C.cyan, width:'24px', height:'24px', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', fontWeight:'800', flexShrink:0 }}>{si+1}</div>
                            <div style={{ fontSize:'13px', color:C.textMuted, lineHeight:'1.6', paddingTop:'2px' }}>{step}</div>
                          </div>
                        ))}
                        <div style={{ marginTop:'16px', display:'flex', gap:'10px', flexWrap:'wrap', alignItems:'center' }}>
                          <MarkFiledButton deadline={d} userId={user?.id} onFiled={handleFiled} alreadyFiled={filedThisMonth.has(d.name)} />
                          <button onClick={()=>startChat('deadline')} style={{ ...btnC, fontSize:'13px', padding:'10px 18px' }}>Ask AI →</button><a href={`https://wa.me/916376103123?text=${encodeURIComponent(`Hi, I need help with ${d.name} due ${d.date}. Can you help me file it? (via Taxpe)`)}`} target="_blank" rel="noreferrer" style={{ ...btnC, fontSize:'13px', padding:'10px 14px', background:'linear-gradient(135deg,#166534,#22c55e)', textDecoration:'none', display:'inline-flex', alignItems:'center', gap:'6px' }}>📱 Talk to CA</a>
                        </div>
                      </>
                    ) : (
                      <div>
                        <div style={{ fontSize:'13px', color:C.orange, fontWeight:'600', marginBottom:'12px', lineHeight:'1.6' }}>
                          You can see this deadline. The filing guide is locked.<br/>
                          <span style={{ color:C.red, fontWeight:'700' }}>Miss this → ₹{d.penalty}/day fine starts automatically.</span>
                        </div>
                        <Locked reason="filing" msg={`Step-by-step guide for ${d.name} is Pro only\nMiss this → ₹${d.penalty}/day fine`} onUpgrade={setUpgradeModal} />
                        <div style={{ marginTop:'14px' }}>
                          <MarkFiledButton deadline={d} userId={user?.id} onFiled={handleFiled} alreadyFiled={filedThisMonth.has(d.name)} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={card()}>
            <div style={{ fontSize:'13px', fontWeight:'700', color:C.cyanLight, marginBottom:'14px' }}>📅 Every Month — What You Must Do</div>
            {[{ d:'7th', t:'TDS payment', c:'Interest @1.5%/month if late' },{ d:'11th', t:'GSTR-1 filing', c:'₹50/day late fee' },{ d:'20th', t:'GSTR-3B + tax payment', c:'₹50/day + 18% interest on unpaid tax' },{ d:'25th', t:'PMT-06 (QRMP)', c:'Interest if missed' }].map((item,i,arr)=>(
              <div key={i} style={{ display:'flex', gap:'12px', padding:'11px 0', borderBottom:i<arr.length-1?`1px solid ${C.border}`:'none', alignItems:'flex-start' }}>
                <div style={{ background:`${C.cyan}18`, color:C.cyan, padding:'4px 10px', borderRadius:'8px', fontSize:'12px', fontWeight:'700', minWidth:'36px', textAlign:'center', flexShrink:0 }}>{item.d}</div>
                <div>
                  <div style={{ fontSize:'13px', color:C.text, fontWeight:'600' }}>{item.t}</div>
                  <div style={{ fontSize:'11px', color:C.red, marginTop:'2px' }}>Miss: {item.c}</div>
                </div>
              </div>
            ))}
          </div>
        </>}

        {tab==='chat' && <>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'18px' }}>
            <div>
              <h2 style={{ fontSize:'20px', fontWeight:'800', color:C.text }}>💬 Ask Taxpe</h2>
              {aiConnected && <div style={{ fontSize:'11px', color:C.green, marginTop:'2px', fontWeight:'600' }}>⚡ Powered by Claude AI — explains like you're 5</div>}
            </div>
            {chatMode==='active' && <button onClick={()=>{ setChatMode('entry'); setMessages([]); }} style={{ background:C.bg2, border:`1px solid ${C.border}`, color:C.textMuted, padding:'6px 12px', borderRadius:'8px', cursor:'pointer', fontSize:'12px', fontFamily:'inherit' }}>← Back</button>}
          </div>

          {!isPremium && (
            <div style={{ background:C.bg1, border:`1px solid ${qLeft===0?C.red:C.border}`, borderRadius:'12px', padding:'12px 16px', marginBottom:'16px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
                <div style={{ fontSize:'12px', color:C.textMuted, fontWeight:'600' }}>Questions today: {questionsUsed}/{FREE_Q}</div>
                {qLeft===0?<button onClick={()=>setUpgradeModal('questions')} style={{ ...btnC, fontSize:'11px', padding:'5px 12px' }}>Get Pro</button>
                  :<div style={{ fontSize:'12px', color:qLeft===1?C.red:C.textDim, fontWeight:qLeft===1?'700':'400' }}>{qLeft===1?'⚠️ Last question':qLeft+' left'}</div>}
              </div>
              <div style={{ background:C.bg2, borderRadius:'4px', height:'4px', overflow:'hidden' }}>
                <div style={{ background:qLeft===0?C.red:qLeft===1?C.orange:C.cyan, width:`${(questionsUsed/FREE_Q)*100}%`, height:'100%', borderRadius:'4px', transition:'width .3s' }} />
              </div>
              {qLeft===0 && <div style={{ fontSize:'11px', color:C.red, marginTop:'7px', fontWeight:'700' }}>⚠️ Limit reached. Wrong tax info = risk of ₹10,000+ fines.</div>}
            </div>
          )}

          {chatMode==='entry' && (
            <div style={{ animation:'fadeUp .4s ease' }}>
              <div style={{ fontSize:'14px', color:C.textMuted, marginBottom:'20px' }}>What's the situation? I'll explain it simply.</div>
              <div style={{ display:'flex', flexDirection:'column', gap:'10px', marginBottom:'22px' }}>
                {[
                  { id:'notice', icon:'📬', title:'I received a notice', sub:'GST, Income Tax, or TDS — this is urgent', color:C.red, border:'#ef444433', big:true },
                  { id:'deadline', icon:'⏰', title:'I have a deadline this week', sub:'Tell me what to file and what happens if I miss it', color:C.orange, border:'#f9731633' },
                  { id:'question', icon:'❓', title:'I have a tax question', sub:'GST rates, ITC, registration, TDS, penalties...', color:C.cyan, border:C.borderCyan },
                ].map(s=>(
                  <div key={s.id} className="situation-card" onClick={()=>startChat(s.id)} style={{ background:C.bg1, border:`1px solid ${s.border}`, borderLeft:`3px solid ${s.color}`, borderRadius:'0 14px 14px 0', padding:s.big?'20px 18px':'16px 18px', display:'flex', alignItems:'center', gap:'16px' }}>
                    <div style={{ fontSize:s.big?'30px':'24px', flexShrink:0 }}>{s.icon}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:'15px', fontWeight:'700', color:C.text }}>{s.title}</div>
                      <div style={{ fontSize:'12px', color:C.textMuted, marginTop:'2px' }}>{s.sub}</div>
                    </div>
                    <div style={{ color:s.color, fontSize:'18px' }}>→</div>
                  </div>
                ))}
              </div>
              <div style={card()}>
                <div style={{ fontSize:'13px', fontWeight:'700', color:C.cyanLight, marginBottom:'12px' }}>🔥 Most asked</div>
                {['How much is the late fee for GSTR-3B?','What happens if I ignore a show cause notice?','Can I claim ITC before GST registration?','How do I reply to a mismatch notice?'].map((q,i)=>(
                  <div key={i} onClick={()=>{ setChatMode('active'); setMessages([{ role:'user', text:q }]); setChatBusy(true); askClaude(q).then(a=>{ setMessages([{ role:'user', text:q },{ role:'assistant', text:a||getFallbackAnswer(q), showEscalate:true }]); setChatBusy(false); }); }} style={{ padding:'10px 0', borderBottom:i<3?`1px solid ${C.border}`:'none', fontSize:'13px', color:C.textMuted, cursor:'pointer', display:'flex', justifyContent:'space-between', transition:'color .15s' }} onMouseOver={e=>e.currentTarget.style.color=C.cyan} onMouseOut={e=>e.currentTarget.style.color=C.textMuted}>
                    <span style={{ display:'flex', gap:'8px' }}><span style={{ color:C.cyan }}>◆</span>{q}</span>
                    <span style={{ color:C.cyan, marginLeft:'8px' }}>→</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {chatMode==='active' && (
            <div>
              <div style={{ ...cardC(), height:'370px', overflowY:'auto', display:'flex', flexDirection:'column', gap:'14px', padding:'16px' }}>
                {messages.map((m,i)=>(
                  <div key={i} className="msg-bubble">
                    <div style={{ display:'flex', justifyContent:m.role==='user'?'flex-end':'flex-start', gap:'8px', alignItems:'flex-end' }}>
                      {m.role==='assistant' && <div style={{ width:'26px', height:'26px', borderRadius:'50%', background:`linear-gradient(135deg,#0e7490,${C.cyan})`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', fontWeight:'900', color:'#000', flexShrink:0 }}>T</div>}
                      <div style={{ background:m.role==='user'?`linear-gradient(135deg,#0e4a5c,${C.cyanDim})`:C.bg2, border:m.role==='user'?`1px solid ${C.cyan}33`:`1px solid ${C.border}`, color:C.text, padding:'11px 15px', borderRadius:m.role==='user'?'18px 18px 4px 18px':'18px 18px 18px 4px', maxWidth:'82%', fontSize:'14px', lineHeight:'1.65', whiteSpace:'pre-wrap' }}>{m.text}</div>
                    </div>
                    {m.showEscalate && <div style={{ display:'flex', gap:'8px', marginTop:'6px', paddingLeft:'34px', alignItems:'center' }}><span style={{ fontSize:'11px', color:C.textDim }}>Still unsure?</span><span style={{ fontSize:'12px', color:C.cyan, cursor:'pointer', fontWeight:'700' }}>Talk to a CA — ₹99 →</span></div>}
                  </div>
                ))}
                {chatBusy && (
                  <div style={{ display:'flex', gap:'8px', alignItems:'flex-end' }}>
                    <div style={{ width:'26px', height:'26px', borderRadius:'50%', background:`linear-gradient(135deg,#0e7490,${C.cyan})`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', fontWeight:'900', color:'#000' }}>T</div>
                    <div style={{ background:C.bg2, border:`1px solid ${C.border}`, padding:'12px 16px', borderRadius:'18px 18px 18px 4px', display:'flex', gap:'6px', alignItems:'center' }}>
                      {[0,1,2].map(i=><div key={i} className={`dot-${i+1}`} style={{ width:'7px', height:'7px', borderRadius:'50%', background:C.cyan }} />)}
                      <span style={{ fontSize:'11px', color:C.textMuted, marginLeft:'4px' }}>Thinking...</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div style={{ display:'flex', gap:'10px', marginTop:'12px' }}>
                <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendChat()} placeholder="Ask anything about GST, TDS, ITR..." className="inp-field" style={{ ...inp(), flex:1 }} disabled={!isPremium&&qLeft===0} />
                <button onClick={()=>sendChat()} style={{ ...btnC, whiteSpace:'nowrap', opacity:!isPremium&&qLeft===0?.5:1 }}>Send ➤</button>
              </div>
            </div>
          )}
        </>}

        {tab==='notice' && <>
          <h2 style={{ fontSize:'20px', fontWeight:'800', color:C.text, marginBottom:'6px' }}>📄 Notice Decoder</h2>
          <div style={{ fontSize:'13px', color:C.textMuted, marginBottom:'14px', lineHeight:'1.6' }}>Got a letter from GST department? Paste it below. {aiConnected?'Claude AI will analyse it.':'I\'ll decode it for you.'}</div>
          <a href="https://services.gst.gov.in/services/auth/fowelcome" target="_blank" rel="noreferrer" style={{ display:'flex', alignItems:'center', gap:'10px', background:'#031a20', border:`1px solid ${C.cyan}33`, borderRadius:'12px', padding:'14px 18px', marginBottom:'16px', textDecoration:'none' }}>
            <span style={{ fontSize:'20px' }}>🔍</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:'13px', fontWeight:'700', color:C.cyan }}>Check My Notices on GST Portal</div>
              <div style={{ fontSize:'11px', color:C.textMuted, marginTop:'2px' }}>Login → Services → View Notices & Orders</div>
            </div>
            <span style={{ color:C.cyan }}>→</span>
          </a>
          {!isPremium && (
            <div style={{ background:`${C.orange}12`, border:`1px solid ${C.orange}33`, borderRadius:'12px', padding:'12px 16px', marginBottom:'16px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'10px' }}>
              <div>
                <div style={{ fontSize:'13px', fontWeight:'700', color:C.orange }}>⚠️ Free: {Math.max(0,2-noticeDecodes)}/2 decodes left this month</div>
                <div style={{ fontSize:'12px', color:C.textMuted, marginTop:'2px' }}>Pro: unlimited + CA reviews your reply</div>
              </div>
              {noticeDecodes>=2 && <button onClick={()=>setUpgradeModal('notice')} style={{ ...btnC, fontSize:'12px', padding:'7px 14px' }}>Unlock Pro →</button>}
            </div>
          )}
          <div style={card()}>
            <textarea value={noticeText} onChange={e=>{ setNoticeText(e.target.value); setNoticeResult(null); setNoticeResolved(false); }} placeholder={"Paste your notice text here...\n\ne.g. 'This is a show cause notice under Section 73 of the CGST Act 2017...'"} className="inp-field" style={{ ...inp(), height:'150px', resize:'vertical', lineHeight:'1.6' }} />
            <button onClick={!isPremium&&noticeDecodes>=2?()=>setUpgradeModal('notice'):decodeNotice} disabled={decoding} style={{ ...btnC, marginTop:'14px', opacity:decoding?.8:1 }}>
              {decoding?<span style={{ display:'flex', alignItems:'center', gap:'8px' }}>{aiConnected?'Claude is analysing...':'Analysing'} {[0,1,2].map(i=><span key={i} className={`dot-${i+1}`} style={{ width:'5px', height:'5px', borderRadius:'50%', background:'#000', display:'inline-block' }} />)}</span>
                :(!isPremium&&noticeDecodes>=2?'🔒 Unlock with Pro':'🔍 What does this mean for me?')}
            </button>
          </div>
          {noticeResult && (
            <div style={{ marginBottom:'16px', animation:'fadeUp .4s ease', borderRadius:'16px', overflow:'hidden', border:`1px solid ${noticeResult.risk==='HIGH'?C.red:noticeResult.risk==='MEDIUM'?C.orange:C.cyan}44` }}>
              <div style={{ background:noticeResult.risk==='HIGH'?'linear-gradient(135deg,#2d0a0a,#3d0f0f)':noticeResult.risk==='MEDIUM'?'linear-gradient(135deg,#2d1200,#3d1800)':'linear-gradient(135deg,#031a20,#052e20)', padding:'18px 20px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div>
                    <div style={{ fontSize:'11px', fontWeight:'800', letterSpacing:'1px', color:noticeResult.risk==='HIGH'?C.red:noticeResult.risk==='MEDIUM'?C.orange:C.cyan, marginBottom:'4px' }}>
                      {noticeResult.risk==='HIGH'?'🔴':noticeResult.risk==='MEDIUM'?'🟠':'🟢'} {noticeResult.risk} RISK NOTICE
                    </div>
                    <div style={{ fontSize:'22px', fontWeight:'900', color:'#fff', marginBottom:'2px' }}>{noticeResult.type}</div>
                    <div style={{ fontSize:'12px', color:C.textMuted }}>{noticeResult.section}</div>
                  </div>
                  {aiConnected && <div style={{ background:`${C.green}15`, border:`1px solid ${C.green}22`, color:C.green, padding:'3px 10px', borderRadius:'8px', fontSize:'10px', fontWeight:'700', flexShrink:0 }}>⚡ AI</div>}
                </div>
              </div>
              {[{ label:'WHAT THEY WANT', value:noticeResult.want },{ label:'YOUR URGENCY', value:noticeResult.urgency, warn:noticeResult.risk==='HIGH' },{ label:'IF YOU IGNORE THIS', value:noticeResult.ignored, warn:true }].map((row,i)=>(
                <div key={i} style={{ background:C.bg1, padding:'14px 20px', borderBottom:`1px solid ${C.border}` }}>
                  <div style={{ fontSize:'10px', fontWeight:'700', letterSpacing:'1px', color:C.textDim, marginBottom:'4px' }}>{row.label}</div>
                  <div style={{ fontSize:'14px', color:row.warn?'#fca5a5':C.text, fontWeight:row.warn?'700':'400', lineHeight:'1.5' }}>{row.value}</div>
                </div>
              ))}
              <div style={{ background:C.bg1, padding:'16px 20px' }}>
                <div style={{ fontSize:'11px', fontWeight:'700', color:C.cyanLight, marginBottom:'12px' }}>✅ EXACT STEPS TO REPLY</div>
                {isPremium||noticeResult.risk==='LOW' ? (
                  <>
                    {noticeResult.steps.map((step,si)=>{
                      const links = [
                        { match:/gstr-2a/i, url:'https://services.gst.gov.in/services/auth/fowelcome', label:'Open GSTR-2A →' },
                        { match:/gst portal|gstin\.gov|services\.gst/i, url:'https://www.gst.gov.in', label:'Open GST Portal →' },
                        { match:/traces|tdscpc/i, url:'https://www.tdscpc.gov.in', label:'Open TRACES →' },
                        { match:/income.?tax|incometax/i, url:'https://www.incometax.gov.in', label:'Open Income Tax Portal →' },
                        { match:/view notice/i, url:'https://www.gst.gov.in', label:'View Notices →' },
                      ];
                      const matched = links.find(l => l.match.test(step));
                      return (
                        <div key={si} style={{ display:'flex', gap:'12px', padding:'10px 0', borderBottom:si<noticeResult.steps.length-1?`1px solid ${C.border}`:'none', alignItems:'flex-start' }}>
                          <div style={{ background:`${C.cyan}18`, color:C.cyan, width:'24px', height:'24px', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', fontWeight:'800', flexShrink:0 }}>{si+1}</div>
                          <div style={{ fontSize:'13px', color:C.textMuted, lineHeight:'1.6', paddingTop:'2px', flex:1 }}>
                            {step}
                            {matched && <a href={matched.url} target="_blank" rel="noreferrer" style={{ display:'inline-block', marginLeft:'8px', color:C.cyan, fontWeight:'700', fontSize:'12px', textDecoration:'none' }}>{matched.label}</a>}
                          </div>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <div>
                    <div style={{ fontSize:'13px', color:C.orange, fontWeight:'700', marginBottom:'12px', lineHeight:'1.6' }}>
                      This is a {noticeResult.risk.toLowerCase()} risk notice. Reply steps are Pro only.<br/>
                      <span style={{ color:C.red }}>Ignoring it: {noticeResult.ignored}</span>
                    </div>
                    <Locked reason="notice" msg={`Reply steps for this ${noticeResult.risk} risk notice are Pro only.\nThis cannot wait.`} onUpgrade={setUpgradeModal} />
                  </div>
                )}
              </div>
            </div>
          )}
          {noticeResult && <InvoiceUploader noticeResult={noticeResult} />}
          {noticeResult && (
            <a
              href={`https://wa.me/916376103123?text=${encodeURIComponent('Hi, I received a ' + noticeResult.type + ' (' + noticeResult.risk + ' risk). Can you review and submit the reply for me? (via Taxpe)')}`}
              target="_blank"
              rel="noreferrer"
              style={{ display:'block', background:'linear-gradient(135deg,#166534,#22c55e)', color:'#fff', border:'none', padding:'16px', borderRadius:'14px', cursor:'pointer', fontWeight:'800', fontSize:'15px', fontFamily:'inherit', boxShadow:'0 4px 20px #22c55e33', textDecoration:'none', textAlign:'center', marginBottom:'12px' }}
            >
              📱 Want a CA to review and submit this for you? — ₹9
            </a>
          )}
          {noticeResult && (
            noticeResolved ? (
              <div style={{ display:'flex', alignItems:'center', gap:'10px', background:`${C.green}15`, border:`1px solid ${C.green}33`, borderRadius:'14px', padding:'14px 18px', marginBottom:'20px' }}>
                <span style={{ fontSize:'20px' }}>✅</span>
                <div>
                  <div style={{ fontSize:'13px', fontWeight:'700', color:C.green }}>Notice Marked as Resolved</div>
                  <div style={{ fontSize:'11px', color:C.textMuted, marginTop:'2px' }}>Saved to your Notice History in the Profile tab.</div>
                </div>
              </div>
            ) : (
              <button
                onClick={handleResolveNotice}
                disabled={resolvingNotice || !user}
                style={{ ...btnG, width:'100%', padding:'14px', fontSize:'14px', opacity:resolvingNotice?0.6:1, marginBottom:'20px' }}
              >
                {resolvingNotice ? '⏳ Saving...' : '✅ Mark Notice as Resolved'}
              </button>
            )
          )}
          {!noticeResult && (
            <div style={card()}>
              <div style={{ fontSize:'13px', fontWeight:'700', color:C.cyanLight, marginBottom:'14px' }}>⚠️ Notice Types — Know Your Risk</div>
              {[{ t:'DRC-01', d:'Tax demand — payment required', r:'HIGH' },{ t:'ASMT-10', d:'Scrutiny — discrepancy in returns', r:'MEDIUM' },{ t:'Show Cause', d:'Explain why penalty should not apply', r:'HIGH' },{ t:'REG-03', d:'Registration clarification needed', r:'LOW' }].map((n,i,arr)=>(
                <div key={i} style={{ display:'flex', gap:'12px', padding:'10px 0', borderBottom:i<arr.length-1?`1px solid ${C.border}`:'none', alignItems:'center' }}>
                  <div style={{ background:`${C.cyan}12`, color:C.cyan, padding:'4px 10px', borderRadius:'8px', fontSize:'11px', fontWeight:'700', minWidth:'72px', textAlign:'center' }}>{n.t}</div>
                  <div style={{ flex:1, fontSize:'13px', color:C.textMuted }}>{n.d}</div>
                  <div style={{ fontSize:'11px', fontWeight:'800', color:n.r==='HIGH'?C.red:n.r==='MEDIUM'?C.orange:C.cyan }}>{n.r}</div>
                </div>
              ))}
            </div>
          )}
        </>}

        {tab==='profile' && <>
          <h2 style={{ fontSize:'20px', fontWeight:'800', color:C.text, marginBottom:'18px' }}>👤 Your Business</h2>
          <div style={card()}>
            <div style={{ fontSize:'13px', fontWeight:'700', color:C.cyanLight, marginBottom:'18px' }}>Business Details</div>
            <div style={{ marginBottom:'14px' }}>
              <label style={{ display:'block', color:C.textMuted, marginBottom:'6px', fontSize:'11px', letterSpacing:'1px', fontWeight:'600' }}>EMAIL</label>
              <input value={user?.email||''} disabled style={{ ...inp(), opacity:.35 }} />
            </div>
            <div style={{ marginBottom:'14px' }}>
              <label style={{ display:'block', color:C.textMuted, marginBottom:'6px', fontSize:'11px', letterSpacing:'1px', fontWeight:'600' }}>BUSINESS NAME</label>
              <input value={bizName} onChange={e=>setBizName(e.target.value)} placeholder="e.g. Sharma Traders Pvt Ltd" className="inp-field" style={inp()} />
            </div>
            <div style={{ marginBottom:'8px' }}>
              <label style={{ display:'block', color:C.textMuted, marginBottom:'6px', fontSize:'11px', letterSpacing:'1px', fontWeight:'600' }}>GSTIN</label>
              <div style={{ display:'flex', gap:'8px', marginBottom:'6px' }}>
  <input value={gstin} onChange={e=>{ setGstin(e.target.value.toUpperCase()); setGstinStatus(null); }} placeholder="e.g. 27AAPFU0939F1ZV" className="inp-field" style={{ ...inp(), fontFamily:'monospace', letterSpacing:'1.5px', flex:1 }} />
  <button onClick={handleGSTINDetect} style={{ ...btnC, whiteSpace:'nowrap', fontSize:'13px', padding:'10px 14px' }}>
    {gstinStatus==='loading' ? '...' : 'Detect'}
  </button>
</div>
{gstinStatus && gstinStatus !== 'loading' && gstinStatus !== 'error' && (
  <div style={{ fontSize:'12px', color:C.green, fontWeight:'700', marginBottom:'4px' }}>✅ {gstinStatus.name} · {gstinStatus.type}</div>
)}
{gstinStatus === 'error' && (
  <div style={{ fontSize:'12px', color:C.red, fontWeight:'700', marginBottom:'4px' }}>⚠️ Invalid GSTIN or not found</div>
)}
<div style={{ fontSize:'11px', color:C.textDim, marginTop:'5px' }}>🔒 Never shared. Used to personalise AI answers.</div>
            </div>
            <div style={{ marginTop:'20px', display:'flex', alignItems:'center', gap:'14px' }}>
              <button onClick={saveProfile} disabled={saving} style={{ ...btnC, opacity:saving?.7:1 }}>{saving?'Saving...':'💾 Save Details'}</button>
              {saved && <span style={{ color:C.green, fontSize:'14px', fontWeight:'700' }}>✅ Saved!</span>}
            </div>
          </div>

          <div style={card()}>
            <div style={{ fontSize:'13px', fontWeight:'700', color:C.cyanLight, marginBottom:'14px' }}>Your Plan & Stats</div>
            {[
              { k:'Plan', v:isPremium?'⭐ Pro — Protected':'Free — At Risk', color:isPremium?C.cyan:C.orange },
              { k:'AI Engine', v:aiConnected?'⚡ Claude AI — Live':'Hardcoded fallback', color:aiConnected?C.green:C.orange },
              { k:'Filing streak', v:filingStreak>0?`${filingStreak} months 🔥`:'No streak yet', color:filingStreak>0?C.yellow:C.textMuted },
              { k:'Penalties avoided', v:`₹${penaltySaved.toLocaleString()}`, color:C.cyan },
              { k:'Total filings recorded', v:filings.length, color:C.text },
              { k:'On-time filings', v:filings.filter(f=>f.was_on_time).length, color:C.green },
              { k:'Late filings', v:filings.filter(f=>!f.was_on_time).length, color:filings.filter(f=>!f.was_on_time).length>0?C.red:C.textMuted },
              { k:'Questions left today', v:isPremium?'∞':qLeft, color:qLeft===0?C.red:C.text },
              { k:'Notice decodes left', v:isPremium?'∞':Math.max(0,2-noticeDecodes), color:noticeDecodes>=2?C.red:C.text },
              { k:'Notices resolved', v:resolvedNotices.length, color:resolvedNotices.length>0?C.green:C.textMuted },
            ].map((row,i,arr)=>(
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'10px 0', borderBottom:i<arr.length-1?`1px solid ${C.border}`:'none' }}>
                <span style={{ fontSize:'13px', color:C.textMuted }}>{row.k}</span>
                <span style={{ fontSize:'13px', fontWeight:'700', color:row.color||C.text }}>{row.v}</span>
              </div>
            ))}
          </div>

          <FilingHistory filings={filings} isPremium={isPremium} onUpgrade={setUpgradeModal} />
          <NoticeHistory notices={resolvedNotices} />
          <div style={{ background:'#0a0a0a', border:'1px solid #22d3ee22', borderRadius:'16px', padding:'20px', marginBottom:'14px' }}>
  <div style={{ fontSize:'13px', fontWeight:'700', color:'#67e8f9', marginBottom:'6px' }}>📊 Monthly Tax Health Report</div>
  <div style={{ fontSize:'12px', color:'#64748b', marginBottom:'14px', lineHeight:'1.6' }}>
    Download your {new Date().toLocaleString('default',{month:'long'})} compliance report — shareable PDF with all your filing details and penalties avoided.
  </div>
  <button onClick={()=>generateTaxReport({ bizName, gstin, filings, filingStreak, penaltySaved, month:new Date().getMonth()+1, year:new Date().getFullYear() })}
    style={{ background:'linear-gradient(135deg,#0e7490,#22d3ee)', color:'#000', border:'none', padding:'11px 20px', borderRadius:'10px', cursor:'pointer', fontWeight:'700', fontSize:'13px', fontFamily:'inherit', boxShadow:'0 4px 16px #22d3ee22' }}>
    📥 Download {new Date().toLocaleString('default',{month:'long'})} {new Date().getFullYear()} Report
  </button>
</div>
          <ReminderSettings userId={user?.id} userEmail={user?.email} />

          {!isPremium && (
            <div style={{ background:`linear-gradient(135deg,${C.bg1},#051a20)`, border:`1px solid ${C.cyan}55`, borderRadius:'18px', padding:'26px' }}>
              <div style={{ fontSize:'11px', fontWeight:'800', letterSpacing:'1px', color:C.cyanDim, marginBottom:'8px' }}>TAXPE PRO</div>
              <div style={{ fontSize:'24px', fontWeight:'900', color:'#fff', marginBottom:'6px' }}>You won't get fined.</div>
              <div style={{ fontSize:'14px', color:C.textMuted, marginBottom:'22px', lineHeight:'1.7' }}>Pro doesn't give you more features. It makes sure you don't lose money.</div>
              <div style={{ background:'#1a0505', border:`1px solid ${C.red}22`, borderRadius:'12px', padding:'14px', marginBottom:'22px' }}>
                <div style={{ fontSize:'11px', color:C.red, fontWeight:'700', marginBottom:'8px' }}>THE MATH</div>
                {[['Miss GSTR-3B (30 days)','₹1,500'],['Miss TDS (30 days)','₹6,000'],['Ignore a notice','₹10,000+'],['Taxpe Pro / month','₹299']].map(([k,v],i)=>(
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderTop:i===3?`1px solid ${C.red}22`:'none', marginTop:i===3?'8px':0 }}>
                    <span style={{ fontSize:'13px', color:i===3?C.cyanLight:'#fca5a5', fontWeight:i===3?'700':'400' }}>{k}</span>
                    <span style={{ fontSize:'13px', color:i===3?C.cyan:C.red, fontWeight:'700' }}>{v}</span>
                  </div>
                ))}
              </div>
              {['WhatsApp reminders — coming soon for everyone','Unlimited AI questions — no daily limit','Filing guide — step-by-step for every return','Notice reply guide — exact steps','CA helpline — 1 call/month included','Monthly tax health report PDF'].map((f,i,arr)=>(
                <div key={i} style={{ display:'flex', gap:'10px', padding:'9px 0', borderBottom:i<arr.length-1?`1px solid ${C.borderCyan}`:'none', fontSize:'13px', color:C.textMuted, alignItems:'center' }}>
                  <span style={{ color:C.cyan, fontSize:'10px', flexShrink:0 }}>◆</span>{f}
                </div>
              ))}
              <button onClick={()=>setUpgradeModal('filing')} style={{ ...btnC, width:'100%', marginTop:'24px', fontSize:'16px', padding:'16px', borderRadius:'12px' }}>
                🚀 Get Pro — ₹299/month
              </button>
              <div style={{ textAlign:'center', color:C.textDim, fontSize:'12px', marginTop:'10px' }}>= ₹10/day • Pays for itself the moment it prevents ONE fine</div>
            </div>
    
