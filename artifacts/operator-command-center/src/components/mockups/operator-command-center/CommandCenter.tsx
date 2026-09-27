import { useMemo, useState, type ReactNode } from 'react';
import {
  Archive,
  ArrowUpRight,
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
  LayoutGrid,
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
  X,
  Zap,
} from 'lucide-react';

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
  strengths: string[];
  watch: string;
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
    summary:
      'A calm systems thinker who has been doing invisible operational work for years. She is not looking for a title; she is looking for a place where her judgment can compound.',
    transcript: [
      { time: '00:18', speaker: 'AI', text: 'What changed recently that made you pick up the phone today?' },
      { time: '00:42', speaker: 'Person', text: 'I have been the person people hand the messy work to. I can make it run, but I keep getting passed over when it is time to name the work.' },
      { time: '01:36', speaker: 'AI', text: 'What would a good next six months protect or make possible?' },
      { time: '02:04', speaker: 'Person', text: 'More stability for my son, honestly. I want to stop rebuilding from scratch every year. I do not need a flashy job, I need a real runway.' },
      { time: '03:28', speaker: 'AI', text: 'When have you felt most capable?' },
      { time: '03:52', speaker: 'Person', text: 'When a team is overwhelmed and I can see the pattern underneath. Give me a tangled process and a week. I will give you back something people can trust.' },
    ],
    strengths: ['Pattern recognition', 'Process ownership', 'Steady under pressure'],
    watch: 'Do not oversell the upside before she has named what stability means to her.',
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
    summary:
      'Practical, dependable, and clear about wanting a job that ends when the shift ends. There may be a good fit in a lower-volatility operations team.',
    transcript: [
      { time: '00:22', speaker: 'AI', text: 'What would make a next job feel like a better chapter?' },
      { time: '00:58', speaker: 'Person', text: 'Predictable hours, a crew that does what they say, and enough left over to sleep at night.' },
      { time: '02:10', speaker: 'AI', text: 'What do people rely on you for?' },
      { time: '02:42', speaker: 'Person', text: 'If I say I am going to be there, I am there. I notice the thing everyone else missed.' },
    ],
    strengths: ['Reliability', 'Situational awareness', 'Hands-on problem solving'],
    watch: 'Respect the preference for a contained, practical next step.',
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
    summary:
      'High agency with a rare ability to translate ambiguity into a usable brief. She is carrying a lot of responsibility and needs a more spacious working environment.',
    transcript: [
      { time: '00:31', speaker: 'AI', text: 'Where do you feel the most friction right now?' },
      { time: '01:07', speaker: 'Person', text: 'I keep being asked to make the impossible legible, then the work disappears once it is legible.' },
      { time: '02:48', speaker: 'AI', text: 'What would you choose if the next move did not need to prove anything?' },
      { time: '03:14', speaker: 'Person', text: 'A small team with a hard problem and enough trust to stay with it.' },
    ],
    strengths: ['Synthesis', 'Ownership', 'Clear written thinking'],
    watch: 'Ask what kind of team makes trust feel earned, not assumed.',
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
    summary:
      'Warm communicator with a broad work history. The immediate question is not capability; it is which constraints are real and which are temporary.',
    transcript: [
      { time: '00:14', speaker: 'AI', text: 'What would you like help deciding?' },
      { time: '00:44', speaker: 'Person', text: 'I know I can work. I do not know which direction is still mine after the last few years.' },
      { time: '02:06', speaker: 'AI', text: 'What has been a good day lately?' },
      { time: '02:35', speaker: 'Person', text: 'One where nobody needed me to be a different person to get through it.' },
    ],
    strengths: ['Empathy', 'Adaptability', 'Customer instinct'],
    watch: 'Stay curious; do not turn ambiguity into a deficit.',
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
    summary:
      'Strong person, but the current brief asks for a time-flexible transition that does not match the availability she described.',
    transcript: [
      { time: '00:26', speaker: 'AI', text: 'What kind of change is possible right now?' },
      { time: '01:01', speaker: 'Person', text: 'I need a job with a firm daytime schedule for the next year.' },
    ],
    strengths: ['People leadership', 'Consistency', 'Conflict repair'],
    watch: 'A respectful no is still useful information.',
  },
];

const planOptions = [
  {
    id: 'reach',
    eyebrow: 'High-upside path',
    title: 'Reach past the average',
    description: 'For a person whose pattern deserves a wider room, without turning possibility into pressure.',
    color: 'coral',
    milestones: [
      ['01', 'Name the through-line', 'Write the three systems problems you solve unusually well.'],
      ['02', 'Make one proof', 'Package a small before / after from your recent work.'],
      ['03', 'Choose the room', 'Talk with two teams where judgment is part of the job.'],
    ],
  },
  {
    id: 'smallest',
    eyebrow: 'Practical path',
    title: 'The smallest number',
    description: 'For a person who wants a sound next step, a clear shift, and room to get their footing back.',
    color: 'sage',
    milestones: [
      ['01', 'Set the floor', 'Define the hours, commute, and pay that make the next move sustainable.'],
      ['02', 'Make a short list', 'Find five teams that can meet the floor without a heroic commute.'],
      ['03', 'Take one meeting', 'Have one low-pressure conversation before deciding anything.'],
    ],
  },
];

function SignalBadge({ signal, tone }: { signal: string; tone: Candidate['signalTone'] }) {
  const toneClass = {
    strong: 'border-[#b9ddd1] bg-[#e5f3ed] text-[#226653]',
    warm: 'border-[#ecd39f] bg-[#fbf2db] text-[#916a22]',
    muted: 'border-[#cad4d2] bg-[#eef2f0] text-[#536663]',
    no: 'border-[#e6c8c5] bg-[#f7e8e5] text-[#a34f48]',
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${toneClass}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{signal}</span>;
}

function MiniAvatar({ candidate, active = false }: { candidate: Candidate; active?: boolean }) {
  return <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold tracking-tight ${active ? 'bg-[#d36d5d] text-[#fff8ec]' : 'bg-[#d9e5df] text-[#27574d]'}`}>{candidate.initials}</div>;
}

function SectionLabel({ icon: Icon, children, action }: { icon: typeof Inbox; children: ReactNode; action?: ReactNode }) {
  return <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[#71837f]"><Icon size={14} strokeWidth={2.4} />{children}</div>{action}</div>;
}

export function CommandCenter() {
  const [selectedId, setSelectedId] = useState(1);
  const [queueFilter, setQueueFilter] = useState<'All' | 'New' | 'Strong signal'>('All');
  const [search, setSearch] = useState('');
  const [context, setContext] = useState<'Transcript' | 'Chat'>('Transcript');
  const [decision, setDecision] = useState<'Undecided' | 'Go' | 'No-go'>('Undecided');
  const [planId, setPlanId] = useState<'reach' | 'smallest'>('reach');
  const [approved, setApproved] = useState(false);
  const [draft, setDraft] = useState(
    'Maya, I heard how often you have been asked to make the messy parts work without getting to name that skill. I would like to show you a practical next step that protects stability while making your systems thinking visible. Would you be open to that?',
  );
  const [sentMessages, setSentMessages] = useState<string[]>([]);
  const [milestones, setMilestones] = useState(planOptions[0].milestones.map((milestone) => milestone[2]));
  const [toast, setToast] = useState('');

  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0];
  const plan = planOptions.find((option) => option.id === planId) ?? planOptions[0];
  const filteredCandidates = useMemo(
    () =>
      candidates.filter((candidate) => {
        const matchesFilter =
          queueFilter === 'All' ||
          (queueFilter === 'New' && candidate.state === 'New') ||
          (queueFilter === 'Strong signal' && candidate.signal === 'Strong signal');
        const matchesSearch =
          !search ||
          `${candidate.name} ${candidate.location} ${candidate.role}`.toLowerCase().includes(search.toLowerCase());
        return matchesFilter && matchesSearch;
      }),
    [queueFilter, search],
  );

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  };

  const selectPlan = (id: 'reach' | 'smallest') => {
    setPlanId(id);
    const next = planOptions.find((option) => option.id === id);
    setMilestones(next?.milestones.map((milestone) => milestone[2]) ?? []);
    setApproved(false);
    showToast(id === 'reach' ? 'High-upside path selected' : 'Practical path selected');
  };

  const sendDraft = () => {
    if (!draft.trim()) return;
    setSentMessages((messages) => [...messages, draft.trim()]);
    setDraft('');
    setApproved(false);
    showToast('Reply sent to conversation');
    setContext('Chat');
  };

  return (
    <div className="command-center min-h-[100dvh] overflow-x-hidden bg-[#e8efeb] text-[#183834]">
      <style>{`
        .command-center { --ink:#183834; --muted:#71837f; --line:#d5e1db; --paper:#f7f8f3; --panel:#fbfcf8; --teal:#226653; --coral:#d36d5d; font-family: 'DM Sans', 'Avenir Next', sans-serif; }
        .command-center * { box-sizing: border-box; }
        .command-center ::selection { background: #f1c27b; color: #183834; }
        .command-center .mono { font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace; }
        .command-center .paper-grain { background-image: radial-gradient(rgba(33,75,67,.07) .7px, transparent .7px); background-size: 7px 7px; }
        .command-center .soft-shadow { box-shadow: 0 12px 30px rgba(31,71,61,.06), 0 2px 5px rgba(31,71,61,.04); }
        .command-center .scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .command-center .scrollbar::-webkit-scrollbar-thumb { background: #c7d6cf; border-radius: 8px; }
        .command-center .fade-in { animation: ccFade .35s ease-out both; }
        @keyframes ccFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .command-center textarea:focus, .command-center input:focus { outline: 2px solid rgba(211,109,93,.25); outline-offset: 1px; }
      `}</style>

      <div className="flex min-h-[100dvh] flex-col lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col bg-[#153b38] px-4 py-5 text-[#dcebe4] lg:w-[230px] lg:min-h-[100dvh]">
          <div className="mb-7 flex items-center gap-3 px-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e9bd76] text-[#153b38]"><Command size={18} strokeWidth={2.6} /></div>
            <div><div className="font-serif text-[17px] font-semibold tracking-[-0.03em] text-[#fff5e6]">fieldwork</div><div className="mono text-[8px] uppercase tracking-[0.18em] text-[#91b0a5]">operator desk</div></div>
          </div>
          <div className="mb-7 rounded-2xl border border-[#3b655d] bg-[#1c4943] px-3 py-3">
            <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#9bb9ae]">Today’s pulse</span><span className="flex items-center gap-1 text-[10px] text-[#dbe8c4]"><span className="h-1.5 w-1.5 rounded-full bg-[#c8d98d]" />live</span></div>
            <div className="mb-1 flex items-end justify-between"><span className="font-serif text-[27px] leading-none text-[#fff7e9]">2,418</span><span className="mono text-[10px] text-[#a9c6bb]">intakes</span></div>
            <div className="h-1 overflow-hidden rounded-full bg-[#2e5a52]"><div className="h-full w-[68%] rounded-full bg-[#e9bd76]" /></div>
            <div className="mt-2 flex justify-between text-[10px] text-[#9bb9ae]"><span>168 awaiting review</span><span>68%</span></div>
          </div>
          <nav className="space-y-1">
            {[
              { icon: Inbox, label: 'Intake queue', count: '168', active: true },
              { icon: Flag, label: 'Needs a decision', count: '24', active: false },
              { icon: MessageSquareText, label: 'Active conversations', count: '11', active: false },
              { icon: Archive, label: 'Closed with care', count: '', active: false },
            ].map(({ icon: Icon, label, count, active }) => (
              <button key={label} onClick={() => showToast(`${label} view selected`)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[12px] transition ${active ? 'bg-[#e9bd76] font-bold text-[#173d38]' : 'text-[#b5cec4] hover:bg-[#214f48] hover:text-[#fff5e6]'}`}>
                <span className="flex items-center gap-3"><Icon size={16} /><span>{label}</span></span>{count && <span className={`mono text-[10px] ${active ? 'text-[#4d6b55]' : 'text-[#819f94]'}`}>{count}</span>}
              </button>
            ))}
          </nav>
          <div className="mt-auto hidden border-t border-[#335e56] pt-4 lg:block">
            <button onClick={() => showToast('Desk settings are ready for review')} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[11px] text-[#9bb9ae] hover:bg-[#214f48] hover:text-[#fff5e6]"><LayoutGrid size={15} />Desk preferences</button>
            <div className="mt-5 flex items-center gap-2 px-3"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#d5e7d6] text-[10px] font-bold text-[#27574d]">AR</div><div><div className="text-[11px] text-[#e5f0e9]">Ari Raines</div><div className="text-[9px] text-[#8eaea2]">solo operator</div></div><button onClick={() => showToast('Notifications are clear')} title="Notifications" className="ml-auto text-[#8eaaa0] hover:text-[#e9bd76]"><Bell size={14} /></button></div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="border-b border-[#d5e1db] bg-[#f6f8f3]/95 px-5 py-4 backdrop-blur md:px-7">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div><div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#71837f]"><span className="h-1.5 w-1.5 rounded-full bg-[#d36d5d]" />Wednesday, October 16 <span className="text-[#b2beb9]">/</span> 09:18 PT</div><h1 className="font-serif text-[28px] leading-none tracking-[-0.04em] text-[#183834]">The work is deciding well.</h1></div>
              <div className="flex items-center gap-2"><button onClick={() => showToast('Queue synced just now')} title="Refresh queue" className="rounded-xl border border-[#cfddd5] bg-[#fbfcf8] p-2.5 text-[#60756e] hover:border-[#9ebdb0] hover:text-[#226653]"><RefreshCw size={15} /></button><button onClick={() => showToast('No urgent alerts')} className="relative rounded-xl border border-[#cfddd5] bg-[#fbfcf8] p-2.5 text-[#60756e] hover:border-[#9ebdb0] hover:text-[#226653]"><Bell size={15} /><span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#d36d5d]" /></button><div className="ml-1 hidden h-9 w-px bg-[#d5e1db] sm:block" /><div className="hidden items-center gap-2 sm:flex"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d5e7d6] text-[10px] font-bold text-[#27574d]">AR</div><span className="text-[11px] font-semibold text-[#46625b]">Ari Raines</span></div></div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                ['168', 'waiting for triage', 'down 12 from 08:00'],
                ['24', 'need a decision', '8 high signal'],
                ['11', 'in conversation', '3 replies due'],
                ['7m', 'median review time', 'within your 10m aim'],
              ].map(([value, label, detail], index) => <div key={label} className="rounded-xl border border-[#dce6df] bg-[#fbfcf8] px-3 py-2.5"><div className="flex items-baseline justify-between"><span className={`font-serif text-[22px] tracking-[-0.04em] ${index === 0 ? 'text-[#d36d5d]' : 'text-[#245d50]'}`}>{value}</span><span className="mono text-[8px] uppercase tracking-[0.06em] text-[#91a29d]">{detail}</span></div><div className="mt-0.5 text-[10px] font-semibold text-[#5d716b]">{label}</div></div>)}
            </div>
          </header>

          <div className="grid min-w-0 grid-cols-1 xl:grid-cols-[310px_minmax(0,1fr)]">
            <section className="border-b border-[#d5e1db] bg-[#eef4ef] xl:min-h-[calc(100dvh-162px)] xl:border-b-0 xl:border-r">
              <div className="sticky top-0 z-10 border-b border-[#d7e3dc] bg-[#eef4ef]/95 px-4 pb-3 pt-4 backdrop-blur">
                <SectionLabel icon={Inbox} action={<button onClick={() => showToast('Queue filters opened')} className="text-[#7e938c] hover:text-[#226653]" title="More filters"><Filter size={14} /></button>}>Incoming queue</SectionLabel>
                <div className="relative mb-3"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#91a49d]" size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people or roles" className="w-full rounded-xl border border-[#d2e0d8] bg-[#f9fbf7] py-2.5 pl-9 pr-3 text-[11px] text-[#234840] placeholder:text-[#9aaba5]" /></div>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5">{(['All', 'New', 'Strong signal'] as const).map((filter) => <button key={filter} onClick={() => setQueueFilter(filter)} className={`whitespace-nowrap rounded-full px-2.5 py-1.5 text-[10px] font-bold ${queueFilter === filter ? 'bg-[#245d50] text-[#f5f7ee]' : 'bg-[#e1ebe4] text-[#6f827c] hover:bg-[#d5e3db]'}`}>{filter}{filter === 'All' && <span className="ml-1 opacity-60">168</span>}</button>)}</div>
              </div>
              <div className="scrollbar max-h-[560px] overflow-y-auto p-2 xl:max-h-[calc(100dvh-245px)]">
                <div className="mb-2 flex items-center justify-between px-2 pt-1"><span className="mono text-[9px] uppercase tracking-[0.12em] text-[#94a59e]">{filteredCandidates.length} visible / sorted by received</span><button onClick={() => showToast('Sort options opened')} className="text-[#8aa099] hover:text-[#226653]"><ChevronDown size={13} /></button></div>
                {filteredCandidates.map((candidate) => <button key={candidate.id} onClick={() => { setSelectedId(candidate.id); setDecision('Undecided'); setApproved(false); setContext('Transcript'); }} className={`fade-in mb-1.5 flex w-full gap-3 rounded-2xl border p-3 text-left transition ${selected.id === candidate.id ? 'border-[#d36d5d] bg-[#fbfcf8] shadow-[0_5px_16px_rgba(33,75,67,.08)]' : 'border-transparent hover:border-[#d2dfd7] hover:bg-[#f8fbf7]'}`}>
                    <MiniAvatar candidate={candidate} active={selected.id === candidate.id} />
                    <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><span className="truncate text-[12px] font-bold text-[#294d45]">{candidate.name}</span><span className="mono shrink-0 text-[9px] text-[#98a7a1]">{candidate.receivedShort}</span></div><div className="mt-0.5 truncate text-[10px] text-[#81928c]">{candidate.role}</div><div className="mt-2 flex items-center justify-between gap-2"><SignalBadge signal={candidate.signal} tone={candidate.signalTone} /><span className={`text-[9px] ${candidate.state === 'Reviewed' ? 'text-[#81928c]' : candidate.state === 'Closed' ? 'text-[#b86a61]' : 'text-[#d28a4c]'}`}>{candidate.state}</span></div></div>
                  </button>)}
                {filteredCandidates.length === 0 && <div className="rounded-2xl border border-dashed border-[#c8d8cf] px-5 py-10 text-center"><Search className="mx-auto mb-2 text-[#a8b8b0]" size={20} /><p className="text-[11px] font-semibold text-[#61766f]">No one matches that search.</p><button onClick={() => { setSearch(''); setQueueFilter('All'); }} className="mt-2 text-[10px] font-bold text-[#c06055]">Clear filters</button></div>}
              </div>
              <div className="mx-4 mb-4 rounded-xl border border-[#d3e0d8] bg-[#e4eee7] p-3"><div className="flex gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#4b806d]" /><p className="text-[10px] leading-[1.45] text-[#5e756c]"><span className="font-bold text-[#356657]">Human review boundary.</span> AI can surface a pattern. Only you decide whether it belongs in someone’s next chapter.</p></div></div>
            </section>

            <section className="min-w-0 bg-[#f7f8f3]">
              <div className="border-b border-[#d5e1db] px-5 py-4 md:px-7">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-3"><MiniAvatar candidate={selected} active /><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-serif text-[25px] tracking-[-0.04em] text-[#193e37]">{selected.name}</h2><SignalBadge signal={selected.signal} tone={selected.signalTone} /></div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#71837f]"><span>{selected.location}</span><span className="text-[#bdc8c3]">•</span><span>{selected.role}</span><span className="text-[#bdc8c3]">•</span><span className="flex items-center gap-1"><Clock3 size={11} />received {selected.received}</span></div></div></div><div className="flex items-center gap-2"><button onClick={() => { setDecision('No-go'); showToast('Marked for a respectful no-go'); }} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] transition ${decision === 'No-go' ? 'border-[#c76b61] bg-[#f5dfdc] text-[#a34f48]' : 'border-[#ddcfca] bg-[#fbf8f3] text-[#a56c64] hover:border-[#c76b61]'}`}><X size={14} />No-go</button><button onClick={() => { setDecision('Go'); showToast('Marked as a go — next step is ready'); }} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] transition ${decision === 'Go' ? 'border-[#4b9078] bg-[#dceee5] text-[#276752]' : 'border-[#b9d6c8] bg-[#f0f7f1] text-[#2d765e] hover:border-[#4b9078]'}`}><Check size={14} />Go</button><button onClick={() => showToast('More candidate actions opened')} className="rounded-xl border border-[#d7e1db] p-2 text-[#71857e] hover:bg-[#edf3ee]"><MoreHorizontal size={16} /></button></div></div>
                <div className="grid gap-3 md:grid-cols-[1.2fr_.8fr]"><div className="rounded-2xl border border-[#dbe5de] bg-[#eef5ef] px-4 py-3"><div className="mb-1 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.13em] text-[#648078]"><Sparkles size={12} className="text-[#c78745]" />Assessment summary</div><p className="text-[12px] leading-[1.55] text-[#46615a]">{selected.summary}</p></div><div className="rounded-2xl border border-[#ead8c6] bg-[#fcf3e7] px-4 py-3"><div className="mb-1 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.13em] text-[#967455]"><Flag size={12} />Operator note</div><p className="text-[11px] leading-[1.55] text-[#735b45]">{selected.watch}</p></div></div>
              </div>

              <div className="grid min-w-0 gap-4 p-5 md:p-7 xl:grid-cols-[minmax(0,1.08fr)_minmax(330px,.92fr)]">
                <div className="min-w-0 space-y-4">
                  <div className="overflow-hidden rounded-2xl border border-[#d7e3dc] bg-[#fbfcf8] soft-shadow">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1e9e3] px-4 py-3"><SectionLabel icon={FileText}>Evidence from intake</SectionLabel><div className="flex rounded-lg bg-[#edf2ed] p-0.5">{(['Transcript', 'Chat'] as const).map((tab) => <button key={tab} onClick={() => setContext(tab)} className={`rounded-md px-3 py-1.5 text-[10px] font-bold ${context === tab ? 'bg-[#fbfcf8] text-[#265e50] shadow-sm' : 'text-[#8a9c95]'}`}>{tab}</button>)}</div></div>
                    {context === 'Transcript' ? <div className="paper-grain max-h-[360px] overflow-y-auto px-4 py-3">{selected.transcript.map((line, index) => <div key={`${line.time}-${index}`} className="group flex gap-3 border-b border-[#e6eee8] py-3 last:border-0"><span className="mono w-9 shrink-0 pt-0.5 text-[9px] text-[#a0afa9]">{line.time}</span><div className="min-w-0"><div className={`mb-1 text-[9px] font-bold uppercase tracking-[0.12em] ${line.speaker === 'AI' ? 'text-[#b07843]' : 'text-[#347360]'}`}>{line.speaker === 'AI' ? 'Retell / prompt' : selected.name}</div><p className={`text-[12px] leading-[1.55] ${line.speaker === 'AI' ? 'text-[#6a746e]' : 'font-medium text-[#294c44]'}`}>{line.text}</p></div></div>)}</div> : <div className="min-h-[300px] bg-[#f6f4ed] px-4 py-4"><div className="mb-4 flex items-center gap-2 text-[10px] text-[#788b84]"><MessageSquareText size={14} />Conversation history <span className="text-[#b4beb8]">/</span> {sentMessages.length} sent replies</div><div className="rounded-xl border border-dashed border-[#d6d9c9] px-4 py-9 text-center"><p className="font-serif text-[18px] text-[#496359]">This can be a human-sized conversation.</p><p className="mx-auto mt-2 max-w-[260px] text-[11px] leading-[1.5] text-[#88958d]">Draft a reply on the right when you are ready. Nothing leaves this desk without your approval.</p></div></div>}
                    <div className="flex items-center justify-between border-t border-[#e1e9e3] bg-[#f2f6f1] px-4 py-2.5"><span className="flex items-center gap-2 text-[10px] text-[#7d9189]"><span className="h-1.5 w-1.5 rounded-full bg-[#65a486]" />Transcript analyzed <span className="text-[#bdc7c1]">•</span> 4 signals surfaced</span><button onClick={() => showToast('Evidence copied to review note')} className="flex items-center gap-1 text-[10px] font-bold text-[#4b7e6a] hover:text-[#d36d5d]"><ArrowUpRight size={12} />Open full intake</button></div>
                  </div>

                  <div className="rounded-2xl border border-[#d7e3dc] bg-[#fbfcf8] p-4 soft-shadow"><SectionLabel icon={Target} action={<span className="mono text-[9px] text-[#9aaaA3]">choose with care</span>}>Assessment</SectionLabel><div className="grid gap-2 sm:grid-cols-3">{[['Fit', 'Strong enough to explore', 'fit'], ['Timing', 'A stable next step now', 'timing'], ['Readiness', 'Open to a conversation', 'ready']].map(([label, text, key]) => <button key={key} onClick={() => showToast(`${label} signal noted`)} className="rounded-xl border border-[#dce7df] bg-[#f5f8f3] p-3 text-left hover:border-[#a8c9b8]"><div className="mb-2 flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.1em] text-[#7f948c]">{label}<CheckCircle2 size={14} className="text-[#64a183]" /></div><div className="text-[11px] font-semibold text-[#36584f]">{text}</div></button>)}</div><div className="mt-3 flex items-center justify-between border-t border-[#e4ebe5] pt-3"><div className="flex items-center gap-2 text-[10px] text-[#71857d]"><Circle size={12} className="text-[#c5d3cc]" /> No automated recommendation</div><button onClick={() => { setDecision('Undecided'); showToast('Decision returned to undecided'); }} className="text-[10px] font-bold text-[#bd695b] hover:text-[#8e443c]">Reset decision</button></div></div>
                </div>

                <div className="min-w-0 space-y-4">
                  <div className="rounded-2xl border border-[#d7e3dc] bg-[#fbfcf8] p-4 soft-shadow"><div className="mb-3 flex items-start justify-between gap-3"><SectionLabel icon={Zap}>Proposed path</SectionLabel><span className="rounded-full bg-[#e8f0df] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.09em] text-[#5d7c50]">editable</span></div><div className="grid gap-2">{planOptions.map((option) => <button key={option.id} onClick={() => selectPlan(option.id)} className={`relative rounded-xl border p-3 text-left transition ${planId === option.id ? option.color === 'coral' ? 'border-[#d88170] bg-[#fcf0e9]' : 'border-[#a9c9b5] bg-[#edf5e9]' : 'border-[#e0e8e1] bg-[#f8faf6] hover:border-[#c5d9cd]'}`}><div className="flex items-start gap-3"><div className={`mt-0.5 h-3.5 w-3.5 rounded-full border-[4px] ${planId === option.id ? option.color === 'coral' ? 'border-[#d36d5d] bg-[#fff7ef]' : 'border-[#5c987b] bg-[#edf5e9]' : 'border-[#cedbd3]'}`} /><div><div className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.13em] text-[#9b866d]">{option.eyebrow}</div><div className="text-[13px] font-bold tracking-[-0.02em] text-[#2f5148]">{option.title}</div><p className="mt-1 text-[10px] leading-[1.4] text-[#72857c]">{option.description}</p></div></div></button>)}</div><div className="mt-4 border-t border-[#e3ebe4] pt-3"><div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[0.11em] text-[#7e9189]">Milestones</span><button onClick={() => showToast('New milestone added to draft')} className="flex items-center gap-1 text-[10px] font-bold text-[#4e806b] hover:text-[#d36d5d]"><Plus size={12} />Add</button></div>{plan.milestones.map(([number, title], index) => <div key={number} className="mb-2 flex gap-2.5 rounded-xl bg-[#f1f5f0] p-2.5"><div className="mono flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#dce9df] text-[9px] font-bold text-[#56816e]">{number}</div><div className="min-w-0 flex-1"><div className="mb-0.5 flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-[#47665b]">{title}</span><Pencil size={11} className="shrink-0 text-[#a6b5ad]" /></div><input value={milestones[index] ?? ''} onChange={(event) => setMilestones((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} className="w-full bg-transparent text-[10px] leading-[1.4] text-[#748780] outline-none" /></div></div>)}</div><button onClick={() => showToast('Plan saved to candidate workspace')} className="mt-2 w-full rounded-xl bg-[#245d50] py-2.5 text-[10px] font-bold uppercase tracking-[0.11em] text-[#f6f4e9] hover:bg-[#1b4b40]">Save proposed path</button></div>

                  <div className="rounded-2xl border border-[#dbcfc2] bg-[#fbf5ec] p-4 soft-shadow"><SectionLabel icon={MessageSquareText} action={<span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.09em] text-[#ae8152]"><ShieldCheck size={12} />human review</span>}>AI-drafted reply</SectionLabel><div className="mb-3 rounded-xl border border-[#eadbca] bg-[#fffaf2] p-3"><textarea value={draft} onChange={(event) => { setDraft(event.target.value); setApproved(false); }} rows={5} className="w-full resize-none bg-transparent text-[12px] leading-[1.55] text-[#4c5e56] outline-none" /><div className="mt-2 flex items-center justify-between border-t border-[#efe1d2] pt-2"><span className="mono text-[9px] text-[#ad9a83]">{draft.length} characters</span><button onClick={() => { setDraft('Maya, your ability to make complicated work dependable is worth a closer look. I have a small next step in mind that keeps stability in view. Would you like to hear it?'); showToast('Draft softened for a first touch'); }} className="flex items-center gap-1 text-[9px] font-bold text-[#ad7650] hover:text-[#d36d5d]"><Sparkles size={11} />Try a shorter draft</button></div></div><div className="flex items-center gap-2"><button onClick={() => setApproved(!approved)} className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-[10px] font-bold uppercase tracking-[0.09em] transition ${approved ? 'border-[#78a98e] bg-[#e1f0e6] text-[#2e735b]' : 'border-[#d9c7b5] bg-[#fffaf3] text-[#8e6b4d] hover:border-[#b8936e]'}`}>{approved ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />}{approved ? 'Approved to send' : 'Approve this reply'}</button><button disabled={!approved || !draft.trim()} onClick={sendDraft} className="flex items-center justify-center gap-2 rounded-xl bg-[#d36d5d] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.09em] text-[#fff8ef] disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[#bb5d50]"><Send size={13} />Send</button></div><p className="mt-2 text-center text-[9px] leading-[1.4] text-[#a08d78]">The person will see this as a text chat, not an automated call.</p></div>

                  <div className="rounded-2xl border border-[#d7e3dc] bg-[#fbfcf8] p-4"><SectionLabel icon={Clock3} action={<button onClick={() => showToast('Conversation history is empty')} className="text-[10px] font-bold text-[#718b80] hover:text-[#d36d5d]">view all</button>}>Conversation history</SectionLabel>{sentMessages.length === 0 ? <div className="flex items-center gap-3 rounded-xl bg-[#f2f6f1] p-3"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e2ece5] text-[#759188]"><MessageSquareText size={15} /></div><div><div className="text-[10px] font-bold text-[#617971]">No messages yet</div><div className="mt-0.5 text-[10px] text-[#91a29b]">A quiet inbox is still a beginning.</div></div></div> : <div className="space-y-2">{sentMessages.map((message, index) => <div key={`${message}-${index}`} className="rounded-xl bg-[#e6f1e9] p-3"><div className="mb-1 flex items-center justify-between text-[9px] text-[#6e8a7c]"><span>You</span><span>just now</span></div><p className="text-[11px] leading-[1.45] text-[#416457]">{message}</p></div>)}</div>}</div>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
      {toast && <div className="fade-in fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#416f61] bg-[#193f39] px-4 py-2.5 text-[11px] font-semibold text-[#f5f0df] shadow-xl"><CheckCircle2 size={14} className="text-[#b8d795]" />{toast}</div>}
    </div>
  );
}
