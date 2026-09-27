import { useMemo, useState, type ReactNode } from 'react';
import {
  Archive,
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Command,
  FileText,
  Filter,
  Flag,
  Inbox,
  Link2,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  X,
  Zap,
} from 'lucide-react';

type MilestoneStatus = 'planned' | 'in progress' | 'worked' | 'changed direction' | 'stalled' | 'ghosted';

type Milestone = {
  id: string;
  number: string;
  title: string;
  prompt: string;
  status: MilestoneStatus;
  outcome: string;
};

type Connection = {
  id: string;
  initials: string;
  name: string;
  role: string;
  sharedGoal: string;
  usefulIntro: string;
  lastOutcome: string;
  safe: boolean;
};

type Candidate = {
  id: number;
  initials: string;
  name: string;
  location: string;
  received: string;
  receivedShort: string;
  signal: 'Strong signal' | 'Worth a look' | 'Needs context' | 'Not a fit';
  signalTone: 'strong' | 'warm' | 'muted' | 'no';
  state: string;
  role: string;
  summary: string;
  transcript: { time: string; speaker: 'AI' | 'Person'; text: string }[];
  watch: string;
  history: { date: string; label: string; detail: string; tone: 'good' | 'quiet' | 'neutral' | 'change' }[];
  connections: Connection[];
};

type PlanOption = {
  id: 'reach' | 'smallest';
  eyebrow: string;
  title: string;
  description: string;
  thesis: string;
  color: 'coral' | 'sage';
  milestones: Milestone[];
};

const candidates: Candidate[] = [
  {
    id: 1,
    initials: 'MC',
    name: 'Maya Chen',
    location: 'Tacoma, WA',
    received: 'Today, 08:42',
    receivedShort: '08:42',
    signal: 'Strong signal',
    signalTone: 'strong',
    state: 'New',
    role: 'Operations / customer systems',
    summary: 'A calm systems thinker who has been doing invisible operational work for years. She is not looking for a title; she is looking for a place where her judgment can compound.',
    watch: 'Do not oversell the upside before she has named what stability means to her.',
    transcript: [
      { time: '00:18', speaker: 'AI', text: 'What changed recently that made you pick up the phone today?' },
      { time: '00:42', speaker: 'Person', text: 'I have been the person people hand the messy work to. I can make it run, but I keep getting passed over when it is time to name the work.' },
      { time: '01:36', speaker: 'AI', text: 'What would a good next six months protect or make possible?' },
      { time: '02:04', speaker: 'Person', text: 'More stability for my son, honestly. I want to stop rebuilding from scratch every year. I do not need a flashy job, I need a real runway.' },
      { time: '03:28', speaker: 'AI', text: 'When have you felt most capable?' },
      { time: '03:52', speaker: 'Person', text: 'When a team is overwhelmed and I can see the pattern underneath. Give me a tangled process and a week. I will give you back something people can trust.' },
    ],
    history: [
      { date: 'Oct 16 · 08:42', label: 'AI intake completed', detail: 'Strong signal surfaced around systems ownership.', tone: 'good' },
      { date: 'Oct 11 · 16:08', label: 'Previous plan paused', detail: 'Role required travel that was not sustainable.', tone: 'change' },
      { date: 'Sep 29 · 12:20', label: 'Went quiet', detail: 'No reply after a second scheduling note.', tone: 'quiet' },
    ],
    connections: [
      { id: 'jr', initials: 'JR', name: 'Jonah Ruiz', role: 'Field service / logistics', sharedGoal: 'A stable next chapter with work that ends at the shift.', usefulIntro: 'Jonah knows a small dispatch team that values dependable systems.', lastOutcome: 'Jonah replied last week; no introduction made.', safe: true },
      { id: 'ad', initials: 'AD', name: 'Amara Dube', role: 'Research / program design', sharedGoal: 'Make invisible problem-solving visible without performing ambition.', usefulIntro: 'Amara could compare notes on turning messy work into a proof.', lastOutcome: 'Amara said yes to a peer conversation in October.', safe: true },
      { id: 'tb', initials: 'TB', name: 'Theo Brooks', role: 'Client support / admin', sharedGoal: 'Find a room where being dependable is enough to belong.', usefulIntro: 'Both are exploring customer operations, but Theo has been quiet.', lastOutcome: 'No contact for 21 days; hold until Theo reappears.', safe: false },
    ],
  },
  {
    id: 2,
    initials: 'JR',
    name: 'Jonah Ruiz',
    location: 'Albuquerque, NM',
    received: 'Today, 08:37',
    receivedShort: '08:37',
    signal: 'Worth a look',
    signalTone: 'warm',
    state: 'New',
    role: 'Field service / logistics',
    summary: 'Practical, dependable, and clear about wanting a job that ends when the shift ends. There may be a good fit in a lower-volatility operations team.',
    watch: 'Respect the preference for a contained, practical next step.',
    transcript: [
      { time: '00:22', speaker: 'AI', text: 'What would make a next job feel like a better chapter?' },
      { time: '00:58', speaker: 'Person', text: 'Predictable hours, a crew that does what they say, and enough left over to sleep at night.' },
      { time: '02:10', speaker: 'AI', text: 'What do people rely on you for?' },
      { time: '02:42', speaker: 'Person', text: 'If I say I am going to be there, I am there. I notice the thing everyone else missed.' },
    ],
    history: [
      { date: 'Oct 16 · 08:37', label: 'AI intake completed', detail: 'Practical path may be a respectful fit.', tone: 'neutral' },
      { date: 'Oct 08 · 10:14', label: 'Conversation resumed', detail: 'Asked for daytime shift examples.', tone: 'good' },
    ],
    connections: [
      { id: 'mc', initials: 'MC', name: 'Maya Chen', role: 'Operations / customer systems', sharedGoal: 'A stable next chapter without starting over.', usefulIntro: 'Maya sees patterns in systems; Jonah sees patterns in the field.', lastOutcome: 'Maya is open to a peer conversation.', safe: true },
      { id: 'ls', initials: 'LS', name: 'Leila Shah', role: 'Retail leadership', sharedGoal: 'Firm daytime work and a reliable team.', usefulIntro: 'Leila knows shift-based operations managers in her region.', lastOutcome: 'Leila is closed with care; do not introduce.', safe: false },
    ],
  },
  {
    id: 3,
    initials: 'AD',
    name: 'Amara Dube',
    location: 'Raleigh, NC',
    received: 'Today, 08:11',
    receivedShort: '08:11',
    signal: 'Strong signal',
    signalTone: 'strong',
    state: 'Reviewed',
    role: 'Research / program design',
    summary: 'High agency with a rare ability to translate ambiguity into a usable brief. She is carrying a lot of responsibility and needs a more spacious working environment.',
    watch: 'Ask what kind of team makes trust feel earned, not assumed.',
    transcript: [
      { time: '00:31', speaker: 'AI', text: 'Where do you feel the most friction right now?' },
      { time: '01:07', speaker: 'Person', text: 'I keep being asked to make the impossible legible, then the work disappears once it is legible.' },
      { time: '02:48', speaker: 'AI', text: 'What would you choose if the next move did not need to prove anything?' },
      { time: '03:14', speaker: 'Person', text: 'A small team with a hard problem and enough trust to stay with it.' },
    ],
    history: [
      { date: 'Oct 16 · 08:11', label: 'Reviewed by operator', detail: 'Conversation is the next useful action.', tone: 'good' },
      { date: 'Oct 12 · 14:30', label: 'Plan changed direction', detail: 'Moved away from an executive-title search.', tone: 'change' },
    ],
    connections: [
      { id: 'mc', initials: 'MC', name: 'Maya Chen', role: 'Operations / customer systems', sharedGoal: 'Make complicated work dependable.', usefulIntro: 'A peer exchange on invisible operations work could help both.', lastOutcome: 'Maya has not been contacted about this.', safe: true },
    ],
  },
  {
    id: 4,
    initials: 'TB',
    name: 'Theo Brooks',
    location: 'Cleveland, OH',
    received: 'Today, 07:54',
    receivedShort: '07:54',
    signal: 'Needs context',
    signalTone: 'muted',
    state: 'New',
    role: 'Client support / admin',
    summary: 'Warm communicator with a broad work history. The immediate question is not capability; it is which constraints are real and which are temporary.',
    watch: 'Stay curious; do not turn ambiguity into a deficit.',
    transcript: [
      { time: '00:14', speaker: 'AI', text: 'What would you like help deciding?' },
      { time: '00:44', speaker: 'Person', text: 'I know I can work. I do not know which direction is still mine after the last few years.' },
      { time: '02:06', speaker: 'AI', text: 'What has been a good day lately?' },
      { time: '02:35', speaker: 'Person', text: 'One where nobody needed me to be a different person to get through it.' },
    ],
    history: [
      { date: 'Oct 16 · 07:54', label: 'AI intake completed', detail: 'Needs a second look at constraints.', tone: 'neutral' },
      { date: 'Sep 25 · 09:10', label: 'Went quiet', detail: 'No response after a resource note.', tone: 'quiet' },
    ],
    connections: [
      { id: 'mc', initials: 'MC', name: 'Maya Chen', role: 'Operations / customer systems', sharedGoal: 'Find a room where capability is enough.', usefulIntro: 'Maya could be a useful listener after Theo has a clearer ask.', lastOutcome: 'Theo has not reopened the thread.', safe: false },
    ],
  },
  {
    id: 5,
    initials: 'LS',
    name: 'Leila Shah',
    location: 'Eugene, OR',
    received: 'Yesterday, 17:26',
    receivedShort: 'Yest.',
    signal: 'Not a fit',
    signalTone: 'no',
    state: 'Closed',
    role: 'Retail leadership',
    summary: 'Strong person, but the current brief asks for a time-flexible transition that does not match the availability she described.',
    watch: 'A respectful no is still useful information.',
    transcript: [
      { time: '00:26', speaker: 'AI', text: 'What kind of change is possible right now?' },
      { time: '01:01', speaker: 'Person', text: 'I need a job with a firm daytime schedule for the next year.' },
    ],
    history: [
      { date: 'Oct 15 · 17:26', label: 'Closed with care', detail: 'Availability did not match the current brief.', tone: 'change' },
      { date: 'Oct 15 · 18:02', label: 'Resource sent', detail: 'Shared a daytime-work referral list.', tone: 'good' },
    ],
    connections: [
      { id: 'jr', initials: 'JR', name: 'Jonah Ruiz', role: 'Field service / logistics', sharedGoal: 'Predictable hours and a reliable team.', usefulIntro: 'Both value a clear workday, but a connection is not needed now.', lastOutcome: 'Closed; no introduction appropriate.', safe: false },
    ],
  },
];

const initialMilestones: Milestone[] = [
  { id: 'm1', number: '01', title: 'Name the through-line', prompt: 'Write the three systems problems you solve unusually well.', status: 'in progress', outcome: 'She named process repair and calm under pressure; proof still unwritten.' },
  { id: 'm2', number: '02', title: 'Make one proof', prompt: 'Package a small before / after from your recent work.', status: 'planned', outcome: 'No artifact yet. Keep it small enough to finish this week.' },
  { id: 'm3', number: '03', title: 'Choose the room', prompt: 'Talk with two teams where judgment is part of the job.', status: 'planned', outcome: 'Waiting until the proof gives the conversation a shape.' },
];

const steadyMilestones: Milestone[] = [
  { id: 's1', number: '01', title: 'Set the floor', prompt: 'Define the hours, commute, and pay that make the next move sustainable.', status: 'planned', outcome: 'Not yet discussed. Start with the floor, not a ceiling.' },
  { id: 's2', number: '02', title: 'Make a short list', prompt: 'Find five teams that can meet the floor without a heroic commute.', status: 'planned', outcome: 'A list is useful only if it respects the constraints.' },
  { id: 's3', number: '03', title: 'Take one meeting', prompt: 'Have one low-pressure conversation before deciding anything.', status: 'planned', outcome: 'No meeting scheduled.' },
];

const planOptions: PlanOption[] = [
  {
    id: 'reach',
    eyebrow: 'High-upside path',
    title: 'Reach past the average',
    description: 'A path for making one person’s unusually useful pattern visible, without turning possibility into pressure.',
    thesis: 'What would you charge one person, once? Not a market. Not a forecast. One person, one time.',
    color: 'coral',
    milestones: initialMilestones,
  },
  {
    id: 'smallest',
    eyebrow: 'Steady path · not a consolation tier',
    title: 'The smallest number',
    description: 'A practical path for getting a sound next step under somebody’s feet. Smaller is not lesser when it is chosen.',
    thesis: 'Five dollars, once, from one person, in a year. The smallest rate anybody picks still gets there.',
    color: 'sage',
    milestones: steadyMilestones,
  },
];

const statusOptions: MilestoneStatus[] = ['planned', 'in progress', 'worked', 'changed direction', 'stalled', 'ghosted'];

function SignalBadge({ signal, tone }: { signal: string; tone: Candidate['signalTone'] }) {
  const toneClass = {
    strong: 'border-[#356958] bg-[#1c3e35] text-[#a9dfbf]',
    warm: 'border-[#765d2c] bg-[#3a3020] text-[#e7c982]',
    muted: 'border-[#465b59] bg-[#283837] text-[#a3b9b4]',
    no: 'border-[#70413e] bg-[#3b2929] text-[#e6a29a]',
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${toneClass}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{signal}</span>;
}

function MiniAvatar({ initials, active = false }: { initials: string; active?: boolean }) {
  return <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold tracking-tight ${active ? 'bg-[#c96859] text-[#fff3e4]' : 'bg-[#294844] text-[#acd1c1]'}`}>{initials}</div>;
}

function SectionLabel({ icon: Icon, children, action }: { icon: typeof Inbox; children: ReactNode; action?: ReactNode }) {
  return <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[#829994]"><Icon size={14} strokeWidth={2.3} />{children}</div>{action}</div>;
}

function statusClass(status: MilestoneStatus) {
  return {
    planned: 'border-[#4a5756] bg-[#252f2f] text-[#b4c1bd]',
    'in progress': 'border-[#8a6332] bg-[#3a2e21] text-[#e5c17d]',
    worked: 'border-[#347660] bg-[#1c3b33] text-[#a9dfbf]',
    'changed direction': 'border-[#546d91] bg-[#263448] text-[#aac4e5]',
    stalled: 'border-[#824a48] bg-[#3d292a] text-[#e4a29b]',
    ghosted: 'border-[#64435e] bg-[#382b38] text-[#d2a8c7]',
  }[status];
}

export function CommandCenter() {
  const [selectedId, setSelectedId] = useState(1);
  const [queueFilter, setQueueFilter] = useState<'All' | 'New' | 'Strong signal'>('All');
  const [search, setSearch] = useState('');
  const [context, setContext] = useState<'Transcript' | 'Chat'>('Transcript');
  const [decision, setDecision] = useState<'Undecided' | 'Go' | 'No-go'>('Undecided');
  const [planId, setPlanId] = useState<'reach' | 'smallest'>('reach');
  const [milestones, setMilestones] = useState<Milestone[]>(initialMilestones);
  const [history, setHistory] = useState(candidates[0].history);
  const [selectedConnectionId, setSelectedConnectionId] = useState('jr');
  const [introProposed, setIntroProposed] = useState(false);
  const [approved, setApproved] = useState(false);
  const [draft, setDraft] = useState('Maya, I heard how often you have been asked to make the messy parts work without getting to name that skill. I would like to show you a practical next step that protects stability while making your systems thinking visible. Would you be open to that?');
  const [sentMessages, setSentMessages] = useState<string[]>([]);
  const [toast, setToast] = useState('');

  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0];
  const plan = planOptions.find((option) => option.id === planId) ?? planOptions[0];
  const connection = selected.connections.find((item) => item.id === selectedConnectionId) ?? selected.connections[0];
  const filteredCandidates = useMemo(() => candidates.filter((candidate) => {
    const matchesFilter = queueFilter === 'All' || (queueFilter === 'New' && candidate.state === 'New') || (queueFilter === 'Strong signal' && candidate.signal === 'Strong signal');
    const matchesSearch = !search || `${candidate.name} ${candidate.location} ${candidate.role}`.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  }), [queueFilter, search]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2300);
  };

  const selectCandidate = (candidate: Candidate) => {
    setSelectedId(candidate.id);
    setDecision('Undecided');
    setContext('Transcript');
    setSentMessages([]);
    setApproved(false);
    setPlanId('reach');
    setMilestones(initialMilestones.map((milestone) => ({ ...milestone })));
    setHistory(candidate.history);
    setSelectedConnectionId(candidate.connections[0]?.id ?? '');
    setIntroProposed(false);
    setDraft(`${candidate.name}, I heard the care you are taking with your next step. I have a small, specific path in mind that keeps your real constraints in view. Would you be open to hearing it?`);
  };

  const selectPlan = (id: 'reach' | 'smallest') => {
    setPlanId(id);
    const next = planOptions.find((option) => option.id === id);
    setMilestones(next?.milestones.map((milestone) => ({ ...milestone })) ?? []);
    setApproved(false);
    showToast(id === 'reach' ? 'High-upside path selected' : 'Steady path selected');
  };

  const updateMilestone = (id: string, patch: Partial<Milestone>) => {
    setMilestones((current) => current.map((milestone) => milestone.id === id ? { ...milestone, ...patch } : milestone));
  };

  const recordMilestone = (milestone: Milestone) => {
    setHistory((current) => [{ date: 'Just now', label: `${milestone.title} updated`, detail: `${milestone.status} · ${milestone.outcome}`, tone: milestone.status === 'worked' ? 'good' : milestone.status === 'ghosted' ? 'quiet' : 'neutral' }, ...current]);
    showToast('Outcome added to case history');
  };

  const sendDraft = () => {
    if (!approved || !draft.trim()) return;
    setSentMessages((current) => [...current, draft.trim()]);
    setDraft('');
    setApproved(false);
    setHistory((current) => [{ date: 'Just now', label: 'Chat reply sent', detail: 'Human-approved message is now in the conversation.', tone: 'good' }, ...current]);
    showToast('Reply sent to conversation');
    setContext('Chat');
  };

  return (
    <div className="command-center min-h-[100dvh] overflow-x-hidden bg-[#151918] text-[#e6eee9]">
      <style>{`
        .command-center { --ink:#e6eee9; --muted:#829994; --line:#2b3a37; --panel:#1c2423; --raised:#222d2b; --teal:#72b79b; --coral:#c96859; font-family:'DM Sans','Avenir Next',sans-serif; }
        .command-center * { box-sizing:border-box; }
        .command-center ::selection { background:#d09668; color:#171b1a; }
        .command-center .mono { font-family:'IBM Plex Mono','SFMono-Regular',monospace; }
        .command-center .serif { font-family:Georgia,'Times New Roman',serif; }
        .command-center .ink-grid { background-image:linear-gradient(rgba(144,179,163,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(144,179,163,.035) 1px,transparent 1px); background-size:24px 24px; }
        .command-center .soft-shadow { box-shadow:0 16px 34px rgba(0,0,0,.15),0 2px 7px rgba(0,0,0,.12); }
        .command-center .scrollbar::-webkit-scrollbar { width:5px; height:5px; }
        .command-center .scrollbar::-webkit-scrollbar-thumb { background:#3a4b47; border-radius:8px; }
        .command-center .fade-in { animation:ccFade .32s ease-out both; }
        .command-center textarea:focus,.command-center input:focus,.command-center select:focus { outline:2px solid rgba(201,104,89,.65); outline-offset:1px; }
        @keyframes ccFade { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <div className="flex min-h-[100dvh] flex-col lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col bg-[#101514] px-4 py-5 text-[#d9e6df] lg:min-h-[100dvh] lg:w-[230px]">
          <div className="mb-7 flex items-center gap-3 px-2"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#ddb077] text-[#16201e]"><Command size={18} strokeWidth={2.6} /></div><div><div className="serif text-[17px] font-semibold tracking-[-0.03em] text-[#f4eadb]">fieldwork</div><div className="mono text-[8px] uppercase tracking-[0.18em] text-[#7f9990]">operator desk</div></div></div>
          <div className="mb-7 rounded-2xl border border-[#334943] bg-[#1a2825] px-3 py-3"><div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#89a49b]">Today’s pulse</span><span className="flex items-center gap-1 text-[10px] text-[#b9d696]"><span className="h-1.5 w-1.5 rounded-full bg-[#b9d696]" />live</span></div><div className="mb-1 flex items-end justify-between"><span className="serif text-[27px] leading-none text-[#f4eadb]">2,418</span><span className="mono text-[10px] text-[#8da79e]">intakes</span></div><div className="h-1 overflow-hidden rounded-full bg-[#2f4540]"><div className="h-full w-[68%] rounded-full bg-[#ddb077]" /></div><div className="mt-2 flex justify-between text-[10px] text-[#8ea79e]"><span>168 awaiting review</span><span>68%</span></div></div>
          <nav className="space-y-1">{[{ icon: Inbox, label: 'Intake queue', count: '168', active: true }, { icon: Flag, label: 'Needs a decision', count: '24', active: false }, { icon: MessageSquareText, label: 'Active conversations', count: '11', active: false }, { icon: Archive, label: 'Closed with care', count: '', active: false }].map(({ icon: Icon, label, count, active }) => <button key={label} onClick={() => showToast(`${label} view selected`)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[12px] transition ${active ? 'bg-[#ddb077] font-bold text-[#1a2522]' : 'text-[#a9c0b8] hover:bg-[#21332f] hover:text-[#f4eadb]'}`}><span className="flex items-center gap-3"><Icon size={16} /><span>{label}</span></span>{count && <span className={`mono text-[10px] ${active ? 'text-[#536e5f]' : 'text-[#718c83]'}`}>{count}</span>}</button>)}</nav>
          <div className="mt-auto hidden border-t border-[#293d38] pt-4 lg:block"><button onClick={() => showToast('Desk settings are ready for review')} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[11px] text-[#91aaa1] hover:bg-[#21332f] hover:text-[#f4eadb]"><Target size={15} />Desk preferences</button><div className="mt-5 flex items-center gap-2 px-3"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#304e47] text-[10px] font-bold text-[#b4d7c6]">AR</div><div><div className="text-[11px] text-[#e1ece6]">Ari Raines</div><div className="text-[9px] text-[#7f9990]">solo operator</div></div><button onClick={() => showToast('No urgent alerts')} title="Notifications" className="ml-auto text-[#7e9990] hover:text-[#ddb077]"><Bell size={14} /></button></div></div>
        </aside>

        <main className="ink-grid min-w-0 flex-1">
          <header className="border-b border-[#2b3a37] bg-[#171d1c]/95 px-5 py-4 backdrop-blur md:px-7"><div className="flex flex-wrap items-center justify-between gap-4"><div><div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#819790]"><span className="h-1.5 w-1.5 rounded-full bg-[#c96859]" />Wednesday, October 16 <span className="text-[#475954]">/</span> 09:18 PT</div><h1 className="serif text-[28px] leading-none tracking-[-0.04em] text-[#f2e7d8]">The work is deciding well.</h1></div><div className="flex items-center gap-2"><button onClick={() => showToast('Queue synced just now')} title="Refresh queue" className="rounded-xl border border-[#33443f] bg-[#202927] p-2.5 text-[#9bb1a8] hover:border-[#5d8473] hover:text-[#d7b57f]"><RefreshCw size={15} /></button><button onClick={() => showToast('No urgent alerts')} title="Notifications" className="relative rounded-xl border border-[#33443f] bg-[#202927] p-2.5 text-[#9bb1a8] hover:border-[#5d8473] hover:text-[#d7b57f]"><Bell size={15} /><span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#c96859]" /></button><div className="ml-1 hidden h-9 w-px bg-[#2c3c38] sm:block" /><div className="hidden items-center gap-2 sm:flex"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#304e47] text-[10px] font-bold text-[#b4d7c6]">AR</div><span className="text-[11px] font-semibold text-[#a6bbb3]">Ari Raines</span></div></div></div><div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">{[['168', 'waiting for triage', 'down 12 from 08:00'], ['24', 'need a decision', '8 high signal'], ['11', 'in conversation', '3 replies due'], ['7m', 'median review time', 'within your 10m aim']].map(([value, label, detail], index) => <div key={label} className="rounded-xl border border-[#2d3d39] bg-[#1d2524] px-3 py-2.5"><div className="flex items-baseline justify-between"><span className={`serif text-[22px] tracking-[-0.04em] ${index === 0 ? 'text-[#d67d6d]' : 'text-[#83c1a6]'}`}>{value}</span><span className="mono text-[8px] uppercase tracking-[0.06em] text-[#70857e]">{detail}</span></div><div className="mt-0.5 text-[10px] font-semibold text-[#9aafa7]">{label}</div></div>)}</div></header>

          <div className="grid min-w-0 grid-cols-1 xl:grid-cols-[310px_minmax(0,1fr)]">
            <section className="border-b border-[#2b3a37] bg-[#19211f] xl:min-h-[calc(100dvh-162px)] xl:border-b-0 xl:border-r"><div className="sticky top-0 z-10 border-b border-[#2c3d38] bg-[#19211f]/95 px-4 pb-3 pt-4 backdrop-blur"><SectionLabel icon={Inbox} action={<button onClick={() => showToast('Queue filters opened')} className="text-[#829b92] hover:text-[#d7b57f]" title="More filters"><Filter size={14} /></button>}>Incoming queue</SectionLabel><div className="relative mb-3"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#70877f]" size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people or roles" className="w-full rounded-xl border border-[#32453f] bg-[#202a27] py-2.5 pl-9 pr-3 text-[11px] text-[#d9e6df] placeholder:text-[#71877f]" /></div><div className="flex gap-1.5 overflow-x-auto pb-0.5">{(['All', 'New', 'Strong signal'] as const).map((filter) => <button key={filter} onClick={() => setQueueFilter(filter)} className={`whitespace-nowrap rounded-full px-2.5 py-1.5 text-[10px] font-bold ${queueFilter === filter ? 'bg-[#8c5d4e] text-[#fff0e6]' : 'bg-[#273632] text-[#91aaa1] hover:bg-[#30443e]'}`}>{filter}{filter === 'All' && <span className="ml-1 opacity-60">168</span>}</button>)}</div></div><div className="scrollbar max-h-[560px] overflow-y-auto p-2 xl:max-h-[calc(100dvh-245px)]"><div className="mb-2 flex items-center justify-between px-2 pt-1"><span className="mono text-[9px] uppercase tracking-[0.12em] text-[#71877f]">{filteredCandidates.length} visible / sorted by received</span><button onClick={() => showToast('Sort options opened')} className="text-[#819991] hover:text-[#d7b57f]"><ChevronDown size={13} /></button></div>{filteredCandidates.map((candidate) => <button key={candidate.id} onClick={() => selectCandidate(candidate)} className={`fade-in mb-1.5 flex w-full gap-3 rounded-2xl border p-3 text-left transition ${selected.id === candidate.id ? 'border-[#c96859] bg-[#252f2d] shadow-[0_7px_20px_rgba(0,0,0,.18)]' : 'border-transparent hover:border-[#354a43] hover:bg-[#202b28]'}`}><MiniAvatar initials={candidate.initials} active={selected.id === candidate.id} /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><span className="truncate text-[12px] font-bold text-[#d9e7df]">{candidate.name}</span><span className="mono shrink-0 text-[9px] text-[#738881]">{candidate.receivedShort}</span></div><div className="mt-0.5 truncate text-[10px] text-[#819992]">{candidate.role}</div><div className="mt-2 flex items-center justify-between gap-2"><SignalBadge signal={candidate.signal} tone={candidate.signalTone} /><span className={`text-[9px] ${candidate.state === 'Reviewed' ? 'text-[#8ca69b]' : candidate.state === 'Closed' ? 'text-[#cf8178]' : 'text-[#d0a26d]'}`}>{candidate.state}</span></div></div></button>)}{filteredCandidates.length === 0 && <div className="rounded-2xl border border-dashed border-[#3a4b46] px-5 py-10 text-center"><Search className="mx-auto mb-2 text-[#71877f]" size={20} /><p className="text-[11px] font-semibold text-[#a8bbb4]">No one matches that search.</p><button onClick={() => { setSearch(''); setQueueFilter('All'); }} className="mt-2 text-[10px] font-bold text-[#d18477]">Clear filters</button></div>}</div><div className="mx-4 mb-4 rounded-xl border border-[#344e43] bg-[#1e342c] p-3"><div className="flex gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#82bb9d]" /><p className="text-[10px] leading-[1.45] text-[#9eb8ac]"><span className="font-bold text-[#b0d8c0]">Human review boundary.</span> AI can surface a pattern. Only you decide whether it belongs in someone’s next chapter.</p></div></div></section>

            <section className="min-w-0 bg-[#171d1c]"><div className="border-b border-[#2b3a37] px-5 py-4 md:px-7"><div className="mb-4 flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-3"><MiniAvatar initials={selected.initials} active /><div><div className="flex flex-wrap items-center gap-2"><h2 className="serif text-[25px] tracking-[-0.04em] text-[#f0e5d6]">{selected.name}</h2><SignalBadge signal={selected.signal} tone={selected.signalTone} /></div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#839891]"><span>{selected.location}</span><span className="text-[#4d5d58]">•</span><span>{selected.role}</span><span className="text-[#4d5d58]">•</span><span className="flex items-center gap-1"><Clock3 size={11} />received {selected.received}</span></div></div></div><div className="flex items-center gap-2"><button onClick={() => { setDecision('No-go'); showToast('Marked for a respectful no-go'); }} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] transition ${decision === 'No-go' ? 'border-[#9c554f] bg-[#422d2c] text-[#eaa39a]' : 'border-[#543936] bg-[#261f1e] text-[#cb847b] hover:border-[#9c554f]'}`}><X size={14} />No-go</button><button onClick={() => { setDecision('Go'); showToast('Marked as a go — next step is ready'); }} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] transition ${decision === 'Go' ? 'border-[#4b987b] bg-[#1d4035] text-[#a9dfbf]' : 'border-[#385f51] bg-[#1d302a] text-[#8bc2a8] hover:border-[#4b987b]'}`}><Check size={14} />Go</button><button onClick={() => showToast('More candidate actions opened')} className="rounded-xl border border-[#33443f] p-2 text-[#81978f] hover:bg-[#25312e]"><MoreHorizontal size={16} /></button></div></div><div className="grid gap-3 md:grid-cols-[1.2fr_.8fr]"><div className="rounded-2xl border border-[#2d4840] bg-[#1c2b27] px-4 py-3"><div className="mb-1 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.13em] text-[#82ae9c]"><Sparkles size={12} className="text-[#d0a26d]" />Assessment summary</div><p className="text-[12px] leading-[1.55] text-[#b3c9bf]">{selected.summary}</p></div><div className="rounded-2xl border border-[#594733] bg-[#2c2720] px-4 py-3"><div className="mb-1 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.13em] text-[#c6a778]"><Flag size={12} />Operator note</div><p className="text-[11px] leading-[1.55] text-[#c4ad8f]">{selected.watch}</p></div></div></div>

              <div className="grid min-w-0 gap-4 p-5 md:p-7 xl:grid-cols-[minmax(0,1.05fr)_minmax(350px,.95fr)]">
                <div className="min-w-0 space-y-4">
                  <div className="overflow-hidden rounded-2xl border border-[#2c3d39] bg-[#1d2524] soft-shadow"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2c3c38] px-4 py-3"><SectionLabel icon={FileText}>Evidence from intake</SectionLabel><div className="flex rounded-lg bg-[#151c1b] p-0.5">{(['Transcript', 'Chat'] as const).map((tab) => <button key={tab} onClick={() => setContext(tab)} className={`rounded-md px-3 py-1.5 text-[10px] font-bold ${context === tab ? 'bg-[#2d3b37] text-[#d8e8df] shadow-sm' : 'text-[#718780]'}`}>{tab}</button>)}</div></div>{context === 'Transcript' ? <div className="max-h-[360px] overflow-y-auto bg-[#1a2321] px-4 py-3">{selected.transcript.map((line, index) => <div key={`${line.time}-${index}`} className="group flex gap-3 border-b border-[#293733] py-3 last:border-0"><span className="mono w-9 shrink-0 pt-0.5 text-[9px] text-[#70857d]">{line.time}</span><div className="min-w-0"><div className={`mb-1 text-[9px] font-bold uppercase tracking-[0.12em] ${line.speaker === 'AI' ? 'text-[#d0a26d]' : 'text-[#80bfa1]'}`}>{line.speaker === 'AI' ? 'Retell / prompt' : selected.name}</div><p className={`text-[12px] leading-[1.55] ${line.speaker === 'AI' ? 'text-[#94a59e]' : 'font-medium text-[#c8d9d0]'}`}>{line.text}</p></div></div>)}</div> : <div className="min-h-[300px] bg-[#201f1b] px-4 py-4"><div className="mb-4 flex items-center gap-2 text-[10px] text-[#9b9b89]"><MessageSquareText size={14} />Conversation history <span className="text-[#575d56]">/</span> {sentMessages.length} sent replies</div>{sentMessages.length === 0 ? <div className="rounded-xl border border-dashed border-[#5a5141] px-4 py-9 text-center"><p className="serif text-[18px] text-[#d0c6af]">This can be a human-sized conversation.</p><p className="mx-auto mt-2 max-w-[260px] text-[11px] leading-[1.5] text-[#9b9888]">Draft a reply on the right when you are ready. Nothing leaves this desk without your approval.</p></div> : <div className="space-y-2">{sentMessages.map((message, index) => <div key={`${message}-${index}`} className="rounded-xl border border-[#4b4e3c] bg-[#2b3025] p-3"><div className="mb-1 flex items-center justify-between text-[9px] text-[#a7ad8c]"><span>You</span><span>just now</span></div><p className="text-[11px] leading-[1.45] text-[#d2d9ba]">{message}</p></div>)}</div>}</div>}<div className="flex items-center justify-between border-t border-[#2c3c38] bg-[#19221f] px-4 py-2.5"><span className="flex items-center gap-2 text-[10px] text-[#82968e]"><span className="h-1.5 w-1.5 rounded-full bg-[#73b99a]" />Transcript analyzed <span className="text-[#4b5c56]">•</span> 4 signals surfaced</span><button onClick={() => showToast('Evidence copied to review note')} className="flex items-center gap-1 text-[10px] font-bold text-[#87b79f] hover:text-[#d78677]"><ArrowRight size={12} />Open full intake</button></div></div>

                  <div className="rounded-2xl border border-[#2c3d39] bg-[#1d2524] p-4 soft-shadow"><SectionLabel icon={Target} action={<span className="mono text-[9px] text-[#748982]">choose with care</span>}>Assessment</SectionLabel><div className="grid gap-2 sm:grid-cols-3">{[['Fit', 'Strong enough to explore'], ['Timing', 'A stable next step now'], ['Readiness', 'Open to a conversation']].map(([label, text]) => <button key={label} onClick={() => showToast(`${label} signal noted`)} className="rounded-xl border border-[#30423d] bg-[#202b28] p-3 text-left hover:border-[#527a68]"><div className="mb-2 flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.1em] text-[#829a91]">{label}<CheckCircle2 size={14} className="text-[#6fb18f]" /></div><div className="text-[11px] font-semibold text-[#bfd2c8]">{text}</div></button>)}</div><div className="mt-3 flex items-center justify-between border-t border-[#2d3c39] pt-3"><div className="flex items-center gap-2 text-[10px] text-[#81948c]"><Circle size={12} className="text-[#53635e]" /> No automated recommendation</div><button onClick={() => { setDecision('Undecided'); showToast('Decision returned to undecided'); }} className="text-[10px] font-bold text-[#cb8176] hover:text-[#eda097]">Reset decision</button></div></div>

                  <div className="rounded-2xl border border-[#2c3d39] bg-[#1d2524] p-4 soft-shadow"><SectionLabel icon={Clock3} action={<button onClick={() => showToast('Case history is the operator record')} className="text-[10px] font-bold text-[#829d92] hover:text-[#d7b57f]">operator record</button>}>Case history / outcome trail</SectionLabel><div className="relative ml-1 border-l border-[#3a4c46] pl-4">{history.slice(0, 5).map((event, index) => <div key={`${event.date}-${event.label}-${index}`} className="relative mb-3 last:mb-0"><span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-[#1d2524] ${event.tone === 'good' ? 'bg-[#6fb18f]' : event.tone === 'quiet' ? 'bg-[#a7666d]' : event.tone === 'change' ? 'bg-[#c79b64]' : 'bg-[#78938a]'}`} /><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-bold text-[#c6d7ce]">{event.label}</div><div className="mt-0.5 text-[10px] leading-[1.4] text-[#849992]">{event.detail}</div></div><span className="mono shrink-0 text-[8px] text-[#6d817a]">{event.date}</span></div></div>)}</div><button onClick={() => { setHistory((current) => [{ date: 'Just now', label: 'Review checkpoint added', detail: 'Operator paused to make the next step explicit.', tone: 'neutral' }, ...current]); showToast('Checkpoint added to case history'); }} className="mt-3 flex items-center gap-1.5 rounded-lg border border-[#344741] px-2.5 py-1.5 text-[10px] font-bold text-[#8db39f] hover:border-[#6b907d]"><Plus size={12} />Add checkpoint</button></div>
                </div>

                <div className="min-w-0 space-y-4">
                  <div className="rounded-2xl border border-[#2c3d39] bg-[#1d2524] p-4 soft-shadow"><div className="mb-3 flex items-start justify-between gap-3"><SectionLabel icon={Zap}>Proposed path</SectionLabel><div className="flex items-center gap-2"><span className="mono text-[8px] text-[#71857d]">AI call · $7</span><span className="rounded-full border border-[#495d4e] bg-[#27372e] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.09em] text-[#a3c88a]">editable</span></div></div><div className="grid gap-2">{planOptions.map((option) => <button key={option.id} onClick={() => selectPlan(option.id)} className={`relative rounded-xl border p-3 text-left transition ${planId === option.id ? option.color === 'coral' ? 'border-[#a86054] bg-[#342624]' : 'border-[#56806a] bg-[#22372d]' : 'border-[#30413d] bg-[#202a28] hover:border-[#526b60]'}`}><div className="flex items-start gap-3"><div className={`mt-0.5 h-3.5 w-3.5 rounded-full border-[4px] ${planId === option.id ? option.color === 'coral' ? 'border-[#d17868] bg-[#342624]' : 'border-[#82bb9d] bg-[#22372d]' : 'border-[#556760]'}`} /><div><div className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.13em] text-[#c5a375]">{option.eyebrow}</div><div className="text-[13px] font-bold tracking-[-0.02em] text-[#d8e5dd]">{option.title}</div><p className="mt-1 text-[10px] leading-[1.4] text-[#8fa49c]">{option.description}</p><p className="mt-2 border-t border-[#3c4135] pt-2 text-[10px] italic leading-[1.4] text-[#c9b98e]">“{option.thesis}”</p></div></div></button>)}</div><div className="mt-4 border-t border-[#2d3e39] pt-3"><div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[0.11em] text-[#849991]">Trackable milestones</span><button onClick={() => { setMilestones((current) => [...current, { id: `new-${Date.now()}`, number: String(current.length + 1).padStart(2, '0'), title: 'Make the next thing explicit', prompt: 'Write the smallest next action and who owns it.', status: 'planned', outcome: 'New milestone; no outcome recorded yet.' }]); showToast('Milestone added to draft'); }} className="flex items-center gap-1 text-[10px] font-bold text-[#87b69e] hover:text-[#d78677]"><Plus size={12} />Add</button></div>{milestones.map((milestone) => <div key={milestone.id} className="mb-2 rounded-xl border border-[#2c3d38] bg-[#202a28] p-2.5"><div className="flex gap-2.5"><div className="mono flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#30443c] text-[9px] font-bold text-[#a4cbb9]">{milestone.number}</div><div className="min-w-0 flex-1"><div className="mb-1 flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-[#c8d9d0]">{milestone.title}</span><Pencil size={11} className="shrink-0 text-[#768c83]" /></div><p className="mb-2 text-[10px] leading-[1.4] text-[#81978e]">{milestone.prompt}</p><div className="grid gap-2 sm:grid-cols-[130px_1fr]"><select value={milestone.status} onChange={(event) => updateMilestone(milestone.id, { status: event.target.value as MilestoneStatus })} className={`rounded-lg border px-2 py-1.5 text-[10px] font-bold capitalize ${statusClass(milestone.status)}`} aria-label={`${milestone.title} status`}>{statusOptions.map((status) => <option key={status} value={status} className="bg-[#202a28] text-[#dce9e2]">{status}</option>)}</select><input value={milestone.outcome} onChange={(event) => updateMilestone(milestone.id, { outcome: event.target.value })} className="min-w-0 rounded-lg border border-[#344741] bg-[#18211f] px-2.5 py-1.5 text-[10px] text-[#b8cbc1] placeholder:text-[#657a72]" aria-label={`${milestone.title} outcome`} /></div><div className="mt-2 flex items-center justify-between gap-2"><span className="text-[9px] italic text-[#778d84]">A stalled step is data, not a verdict.</span><button onClick={() => recordMilestone(milestone)} className="shrink-0 text-[9px] font-bold text-[#8bb89f] hover:text-[#e19a8d]">Record outcome</button></div></div></div></div>)}</div><div className="mt-3 flex items-center justify-between gap-2"><span className="text-[9px] text-[#70857d]">chat pricing · not set</span><button onClick={() => { setHistory((current) => [{ date: 'Just now', label: 'Plan saved', detail: `${plan.title} with ${milestones.length} milestones.`, tone: 'neutral' }, ...current]); showToast('Plan saved to candidate workspace'); }} className="rounded-xl bg-[#326b57] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.11em] text-[#e7f4ea] hover:bg-[#3f8068]">Save proposed path</button></div></div>

                  <div className="rounded-2xl border border-[#2f4640] bg-[#1c2926] p-4 soft-shadow"><div className="mb-3 flex items-start justify-between gap-3"><SectionLabel icon={Users}>Private relationship canvas</SectionLabel><span className="mono text-[8px] uppercase tracking-[0.1em] text-[#718a81]">operator only</span></div><div className="mb-3 flex items-center gap-2 text-[10px] text-[#94aba2]"><Link2 size={13} className="text-[#d0a26d]" />Network view · {selected.connections.length} adjacent intakes</div><div className="relative mb-3 h-[142px] overflow-hidden rounded-xl border border-[#2e4940] bg-[#16211f]"><div className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-[#d17868] bg-[#3a2928] text-[11px] font-bold text-[#f0b6a8]">{selected.initials}</div><span className="mt-1 rounded bg-[#1b2825] px-1.5 py-0.5 text-[8px] font-bold text-[#d2dfd7]">{selected.name}</span></div>{selected.connections.map((item, index) => { const positions = ['left-[12%] top-[17%]', 'right-[11%] top-[16%]', 'right-[13%] bottom-[10%]']; return <button key={item.id} onClick={() => setSelectedConnectionId(item.id)} className={`absolute z-10 flex flex-col items-center ${positions[index % positions.length]}`}><div className={`flex h-9 w-9 items-center justify-center rounded-xl border text-[10px] font-bold ${selectedConnectionId === item.id ? 'border-[#ddb077] bg-[#4a392a] text-[#f1d09d]' : 'border-[#45645a] bg-[#263a34] text-[#a9cebc]'}`}>{item.initials}</div><span className="mt-1 max-w-[70px] truncate text-[8px] text-[#8da79d]">{item.name}</span></button> })}<div className="absolute left-[25%] top-[42%] h-px w-[24%] rotate-[17deg] bg-[#527666]" /><div className="absolute right-[24%] top-[41%] h-px w-[25%] -rotate-[16deg] bg-[#527666]" /><div className="absolute bottom-[28%] right-[26%] h-px w-[23%] rotate-[25deg] bg-[#6e5a4f]" /><div className="absolute left-3 top-3 rounded-full border border-[#3b5549] bg-[#1d302b] px-2 py-1 text-[8px] font-bold uppercase tracking-[0.1em] text-[#92b6a4]">shared context</div></div>{connection && <div className="rounded-xl border border-[#334b42] bg-[#22302c] p-3"><div className="mb-2 flex items-center justify-between gap-2"><div className="flex items-center gap-2"><MiniAvatar initials={connection.initials} /><div><div className="text-[11px] font-bold text-[#d3e2da]">{connection.name}</div><div className="text-[9px] text-[#819991]">{connection.role}</div></div></div><span className={`rounded-full border px-2 py-1 text-[8px] font-bold uppercase tracking-[0.08em] ${connection.safe ? 'border-[#3f795f] bg-[#1c3b31] text-[#9dd5b4]' : 'border-[#76464b] bg-[#3b292f] text-[#dfa0a4]'}`}>{connection.safe ? 'safe to explore' : 'hold / not appropriate'}</span></div><div className="grid gap-2 text-[10px] sm:grid-cols-3"><div><div className="mb-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-[#748d84]">Shared goal</div><p className="leading-[1.35] text-[#b8cbc1]">{connection.sharedGoal}</p></div><div><div className="mb-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-[#748d84]">Useful introduction</div><p className="leading-[1.35] text-[#b8cbc1]">{connection.usefulIntro}</p></div><div><div className="mb-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-[#748d84]">Last outcome</div><p className="leading-[1.35] text-[#b8cbc1]">{connection.lastOutcome}</p></div></div><button disabled={!connection.safe} onClick={() => { setIntroProposed(!introProposed); showToast(introProposed ? 'Introduction proposal removed' : 'Introduction proposal recorded'); }} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#6a846e] bg-[#283a30] py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#b6d3b0] disabled:cursor-not-allowed disabled:border-[#414d49] disabled:bg-[#252c2b] disabled:text-[#697872]">{introProposed ? <CheckCircle2 size={13} /> : <Link2 size={13} />}{introProposed ? 'Introduction proposed' : 'Propose introduction'}</button></div>}</div>

                  <div className="rounded-2xl border border-[#574431] bg-[#2b251f] p-4 soft-shadow"><SectionLabel icon={MessageSquareText} action={<span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.09em] text-[#c39b6c]"><ShieldCheck size={12} />human review</span>}>AI-drafted reply</SectionLabel><div className="mb-3 rounded-xl border border-[#5a4733] bg-[#332a21] p-3"><textarea value={draft} onChange={(event) => { setDraft(event.target.value); setApproved(false); }} rows={5} className="w-full resize-none bg-transparent text-[12px] leading-[1.55] text-[#ddcfbd] outline-none" /><div className="mt-2 flex items-center justify-between border-t border-[#564533] pt-2"><span className="mono text-[9px] text-[#ae967c]">{draft.length} characters</span><button onClick={() => { setDraft(`${selected.name}, your ability to make complicated work dependable is worth a closer look. I have a small next step in mind that keeps stability in view. Would you like to hear it?`); showToast('Draft shortened for a first touch'); }} className="flex items-center gap-1 text-[9px] font-bold text-[#d1a06e] hover:text-[#f0b19f]"><Sparkles size={11} />Try a shorter draft</button></div></div><div className="flex items-center gap-2"><button onClick={() => setApproved(!approved)} className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-[10px] font-bold uppercase tracking-[0.09em] transition ${approved ? 'border-[#568d72] bg-[#234032] text-[#a9dfbf]' : 'border-[#69533c] bg-[#332a21] text-[#d2a66f] hover:border-[#a68158]'}`}>{approved ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />}{approved ? 'Approved to send' : 'Approve this reply'}</button><button disabled={!approved || !draft.trim()} onClick={sendDraft} className="flex items-center justify-center gap-2 rounded-xl bg-[#c96859] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.09em] text-[#fff0e5] disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[#d77b6b]"><Send size={13} />Send</button></div><p className="mt-2 text-center text-[9px] leading-[1.4] text-[#a7917a]">The person will see this as a text chat, not an automated call.</p></div>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
      {toast && <div className="fade-in fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#466e5e] bg-[#1c3b32] px-4 py-2.5 text-[11px] font-semibold text-[#e5f0e8] shadow-xl"><CheckCircle2 size={14} className="text-[#b8d795]" />{toast}</div>}
    </div>
  );
}
