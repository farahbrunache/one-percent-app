import { useState } from 'react';
import { ArrowDownToLine, Check, ChevronRight, FileEdit, Flag, GitBranch, History, Link2, ListChecks, RotateCcw, Send, Users } from 'lucide-react';
import {
  AlertBox,
  Card,
  CodeLine,
  Field,
  PhoneShell,
  PreviewStates,
  PrimaryButton,
  SectionLabel,
  StatusPill,
  TrustLine,
} from './_shared/Ui';

type CaseState = 'worklist' | 'sheet' | 'quote' | 'introductions' | 'end' | 'funnel' | 'calls' | 'script';

const states: { value: CaseState; label: string }[] = [
  { value: 'worklist', label: 'owed' },
  { value: 'sheet', label: 'sheet' },
  { value: 'quote', label: 'quotes' },
  { value: 'introductions', label: 'introductions' },
  { value: 'end', label: 'where it ends' },
  { value: 'funnel', label: 'progress' },
  { value: 'calls', label: 'call records' },
  { value: 'script', label: 'export script' },
];

export function CaseDeliverables() {
  const [state, setState] = useState<CaseState>('worklist');
  const [amount, setAmount] = useState('24');
  const [covers, setCovers] = useState('One written review of the offer and first-payment path.');
  const [outcome, setOutcome] = useState('');
  const [saved, setSaved] = useState(false);

  return (
    <PhoneShell
      eyebrow="one percent / operator case"
      title="Case record"
      subtitle="Reference H8TF7-AFJYL. The worklist, deliverable, and recorded outcomes live at the top of the record."
      footer={<TrustLine>Operator-only · changes are recorded in case history</TrustLine>}
    >
      <PreviewStates value={state} options={states} onChange={(value) => { setState(value); setSaved(false); }} />

      {state === 'worklist' && (
        <div className="fade-in space-y-3">
          <div className="flex items-center justify-between"><SectionLabel icon={ListChecks}>what is owed</SectionLabel><StatusPill tone="gold">3 remaining</StatusPill></div>
          <CodeLine code="H8TF7-AFJYL" />
          {[
            ['01', 'Keep the call record', 'Call record is attached', true],
            ['02', 'Decide whether to continue', 'Decision not recorded', false],
            ['03', 'Write the sheet', 'The deliverable is not written', false],
          ].map(([number, title, detail, done]) => (
            <div key={number} className={`rounded-2xl border p-3 ${done ? 'border-[#3d6452] bg-[#1d3028]' : 'border-[#344640] bg-[#1d2523]'}`}>
              <div className="flex items-start gap-3"><div className={`mono text-[10px] font-bold ${done ? 'text-[#8fc0a3]' : 'text-[#d7b57f]'}`}>{number}</div><div className="min-w-0 flex-1"><div className="text-[12px] font-bold text-[#d8e6df]">{title}</div><div className="mt-1 text-[10px] text-[#8da79d]">{detail}</div></div>{done && <Check size={15} className="text-[#8fc0a3]" />}</div>
            </div>
          ))}
          <Card tone="gold"><div className="flex gap-2 text-[10px] leading-[1.45] text-[#c7b58e]"><History size={14} className="mt-0.5 shrink-0" />Every change below writes one case-history fact. The list is work, not decoration.</div></Card>
        </div>
      )}

      {state === 'sheet' && (
        <div className="fade-in space-y-3">
          <div className="flex items-center justify-between"><SectionLabel icon={FileEdit}>the sheet</SectionLabel><span className="mono text-[9px] text-[#71877f]">draft</span></div>
          <Card tone="sage">
            <div className="mono text-[8px] uppercase tracking-[0.14em] text-[#83b89a]">deliverable · not visible yet</div>
            <h2 className="serif mt-2 text-[22px] leading-[1.05] text-[#e5efe9]">Make the first offer smaller.</h2>
            <div className="mt-4 space-y-3 text-[11px] leading-[1.55] text-[#b5cec0]">
              <p>Start with one buyer who already names the problem in the same words you use. Do not build the full service before that conversation.</p>
              <p>Write the offer as a fixed outcome, not a menu of capabilities. The first version should be deliverable in one afternoon.</p>
              <p>Ask for the payment before adding the second feature.</p>
            </div>
          </Card>
          <div className="flex items-center justify-between rounded-xl border border-[#344640] bg-[#1d2523] px-3 py-2.5 text-[10px] text-[#9fb5ab]"><span>last edited</span><span className="font-bold text-[#d0dfd7]">not written</span></div>
          <PrimaryButton tone="sage" onClick={() => setSaved(true)} className="w-full"><Check size={14} />{saved ? 'Sheet marked written' : 'Save and mark written'}</PrimaryButton>
          {saved && <AlertBox tone="sage">Sheet written just now. It is now readable from the account library.</AlertBox>}
        </div>
      )}

      {state === 'quote' && (
        <div className="fade-in space-y-3">
          <div className="flex items-center justify-between"><SectionLabel icon={FileEdit}>quotes</SectionLabel><StatusPill tone="gold">one person</StatusPill></div>
          <Card>
            <div className="grid grid-cols-[1fr_105px] gap-3"><Field label="Amount" value={amount} onChange={setAmount} prefix="$" /><label className="block"><span className="mono mb-1.5 block text-[8px] font-bold uppercase tracking-[0.13em] text-[#829991]">state</span><select className="w-full rounded-xl border border-[#3b4d47] bg-[#202a27] px-2 py-2.5 text-[11px] text-[#dce9e2]"><option>Written</option><option>Agreed</option><option>Declined</option></select></label></div>
            <label className="mt-3 block"><span className="mono mb-1.5 block text-[8px] font-bold uppercase tracking-[0.13em] text-[#829991]">what it covers</span><textarea value={covers} onChange={(event) => setCovers(event.target.value)} rows={3} className="w-full resize-none rounded-xl border border-[#3b4d47] bg-[#202a27] px-3 py-2.5 text-[11px] leading-[1.45] text-[#dce9e2]" /></label>
          </Card>
          <PrimaryButton tone="coral" onClick={() => setSaved(true)} className="w-full"><Send size={14} />{saved ? 'Quote saved · written' : 'Write quote'}</PrimaryButton>
          <div className="space-y-2"><div className="flex items-center justify-between rounded-xl border border-[#344640] bg-[#1d2523] px-3 py-2.5"><div><div className="text-[10px] font-bold text-[#d0dfd7]">Offer clarity review</div><div className="mt-1 text-[9px] text-[#80978e]">Covers one written review of the offer.</div></div><div className="serif text-[21px] text-[#e3c18a]">$24</div></div><div className="flex items-center justify-between rounded-xl border border-[#344640] bg-[#1d2523] px-3 py-2.5"><div><div className="text-[10px] font-bold text-[#d0dfd7]">First customer plan</div><div className="mt-1 text-[9px] text-[#80978e]">Covers three checks before the first ask.</div></div><StatusPill tone="coral">declined</StatusPill></div></div>
        </div>
      )}

      {state === 'introductions' && (
        <div className="fade-in space-y-3">
          <div className="flex items-center justify-between"><SectionLabel icon={Users}>introductions</SectionLabel><StatusPill tone="sage">same record both ways</StatusPill></div>
          <Card>
            <div className="grid grid-cols-2 gap-3"><Field label="Reference one" value="H8TF7-AFJYL" onChange={() => {}} /><Field label="Reference two" value="P4NV1-JF3QX" onChange={() => {}} /></div>
            <label className="mt-3 block"><span className="mono mb-1.5 block text-[8px] font-bold uppercase tracking-[0.13em] text-[#829991]">why</span><textarea defaultValue="Both are testing a fixed offer with one first buyer." rows={3} className="w-full resize-none rounded-xl border border-[#3b4d47] bg-[#202a27] px-3 py-2.5 text-[11px] leading-[1.45] text-[#dce9e2]" /></label>
            <label className="mt-3 block"><span className="mono mb-1.5 block text-[8px] font-bold uppercase tracking-[0.13em] text-[#829991]">what came of it</span><textarea value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="No outcome recorded" rows={2} className="w-full resize-none rounded-xl border border-[#3b4d47] bg-[#202a27] px-3 py-2.5 text-[11px] leading-[1.45] text-[#dce9e2] placeholder:text-[#647a72]" /></label>
          </Card>
          <PrimaryButton tone="sage" onClick={() => setSaved(true)} className="w-full"><Link2 size={14} />{saved ? 'Introduction recorded' : 'Record introduction'}</PrimaryButton>
          <Card tone="gold"><div className="flex gap-2 text-[10px] leading-[1.45] text-[#c7b58e]"><RotateCcw size={14} className="mt-0.5 shrink-0" />This fact appears on both records and can be reversed.</div></Card>
        </div>
      )}

      {state === 'end' && (
        <div className="fade-in space-y-3">
          <div className="flex items-center justify-between"><SectionLabel icon={Flag}>where it ends</SectionLabel><StatusPill tone="gold">one fact</StatusPill></div>
          <Card tone="sage">
            <div className="flex items-start gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2b4a3d] text-[#a8d6bc]"><Flag size={17} /></div><div><div className="text-[12px] font-bold text-[#d7e9df]">First paying customer recorded</div><p className="mt-1 text-[10px] leading-[1.45] text-[#94b1a3]">One person paid for the offer. This is the end of the work on this record.</p></div></div>
            <div className="mt-4 border-t border-[#385848] pt-3 text-[10px] text-[#9ab7a8]"><span className="text-[#6f8a7e]">recorded</span><span className="ml-2 font-bold text-[#d2e4da]">16 Oct · $45 · one-time</span></div>
          </Card>
          <PrimaryButton tone="quiet" onClick={() => setSaved(true)} className="w-full"><RotateCcw size={14} />{saved ? 'Fact reversed' : 'Reverse this fact'}</PrimaryButton>
          {saved && <AlertBox tone="gold">The outcome is reversible and the reversal is added to case history.</AlertBox>}
        </div>
      )}

      {state === 'funnel' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={GitBranch}>how far people get</SectionLabel>
          <p className="mb-4 text-[10px] leading-[1.45] text-[#839a90]">Each figure is a strict subset of the one above it.</p>
          {[
            ['calls came back', '48', '100%'],
            ['worth going on with', '31', '65%'],
            ['on a path', '18', '38%'],
            ['something worked', '7', '15%'],
            ['first paying customer', '2', '4%'],
          ].map(([label, value, percent], index) => (
            <div key={label} className="rounded-xl border border-[#344640] bg-[#1d2523] p-3"><div className="flex items-baseline justify-between"><span className="text-[10px] font-bold text-[#b4c9bf]">{label}</span><span className="serif text-[24px] text-[#d7b57f]">{value}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#2c3f39]"><div className="h-full rounded-full bg-[#73aa8e]" style={{ width: `${Math.max(8, 100 - index * 20)}%` }} /></div><div className="mt-1 text-right mono text-[8px] text-[#71877f]">{percent}</div></div>
          ))}
        </div>
      )}

      {state === 'calls' && (
        <div className="fade-in space-y-3">
          <div className="flex items-center justify-between"><SectionLabel icon={History}>returned call records</SectionLabel><StatusPill tone="sage">2 calls</StatusPill></div>
          <Card tone="sage"><div className="flex items-center justify-between"><div><div className="mono text-[9px] uppercase tracking-[0.1em] text-[#83b89a]">call 02 · restart</div><div className="mt-1 text-[11px] font-bold text-[#d7e9df]">Returned 16 Oct · 27 minutes</div></div><ChevronRight size={16} className="text-[#8fc0a3]" /></div><div className="mt-3 text-[10px] leading-[1.45] text-[#9ab7a8]">The first call dropped. This is the returned record that counts toward the case.</div></Card>
          <Card><div className="flex items-center justify-between"><div><div className="mono text-[9px] uppercase tracking-[0.1em] text-[#829991]">call 01 · dropped</div><div className="mt-1 text-[11px] font-bold text-[#aebfb7]">No returned record</div></div><StatusPill>hidden</StatusPill></div><div className="mt-3 text-[10px] leading-[1.45] text-[#829991]">Only calls that came back are shown in the working record.</div></Card>
        </div>
      )}

      {state === 'script' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={ArrowDownToLine}>voice agent script</SectionLabel>
          <Card>
            <div className="mono text-[8px] uppercase tracking-[0.14em] text-[#829991]">exportable · current version</div>
            <div className="mt-3 space-y-2 font-mono text-[10px] leading-[1.55] text-[#b4c9bf]"><div><span className="text-[#d7b57f]">01</span> Ask what changed today.</div><div><span className="text-[#d7b57f]">02</span> Ask what one person might pay for once.</div><div><span className="text-[#d7b57f]">03</span> Ask what would make a first customer possible.</div><div><span className="text-[#d7b57f]">04</span> Ask what must remain true for the next step.</div></div>
          </Card>
          <PrimaryButton tone="gold" onClick={() => setSaved(true)} className="w-full"><ArrowDownToLine size={14} />{saved ? 'Script export prepared' : 'Export call script'}</PrimaryButton>
          <AlertBox tone="gold">The export is a copy of the script the voice agent runs. It does not expose call records.</AlertBox>
        </div>
      )}
    </PhoneShell>
  );
}