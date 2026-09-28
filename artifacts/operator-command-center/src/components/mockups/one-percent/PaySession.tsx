import { useState } from 'react';
import { ArrowRight, Banknote, Check, Gift, KeyRound, Search, WalletCards } from 'lucide-react';
import {
  BackLabel,
  Card,
  CodeLine,
  AlertBox,
  Field,
  PhoneShell,
  PreviewStates,
  PrimaryButton,
  SectionLabel,
  StatusPill,
  TrustLine,
} from './_shared/Ui';

type PayState = 'route' | 'wise' | 'gift' | 'handed' | 'recover' | 'empty' | 'failed';

const states: { value: PayState; label: string }[] = [
  { value: 'route', label: 'choose route' },
  { value: 'wise', label: 'Wise' },
  { value: 'gift', label: 'gift card' },
  { value: 'handed', label: 'claim link' },
  { value: 'recover', label: 'recover' },
  { value: 'empty', label: 'no route' },
  { value: 'failed', label: 'payment failed' },
];

export function PaySession() {
  const [state, setState] = useState<PayState>('route');
  const [reference, setReference] = useState('');
  const [giftCode, setGiftCode] = useState('');
  const [message, setMessage] = useState('');

  const handOver = () => {
    setState('handed');
    setMessage('Payment recorded for design review');
  };

  return (
    <PhoneShell
      eyebrow="one percent / session purchase"
      title="Pay for a session"
      subtitle="A half-hour voice call about what one person might pay for once, and what it would take to get a first paying customer."
      footer={<TrustLine>One session · $7 · no account required</TrustLine>}
    >
      <PreviewStates value={state} options={states} onChange={(value) => { setState(value); setMessage(''); }} />

      {state !== 'route' && state !== 'handed' && state !== 'recover' && (
        <BackLabel onClick={() => setState('route')}>choose another route</BackLabel>
      )}

      {state === 'route' && (
        <div className="fade-in space-y-3">
          <div className="mb-4 flex items-end justify-between">
            <div><SectionLabel icon={WalletCards}>one session</SectionLabel><div className="serif text-[41px] leading-none tracking-[-0.06em] text-[#f4eadb]">$7</div></div>
            <StatusPill tone="gold">real money</StatusPill>
          </div>
          <Card tone="sage" className="cursor-pointer transition hover:border-[#6b9d83]" >
            <button onClick={() => setState('wise')} className="w-full text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2b4a3d] text-[#a8d6bc]"><Banknote size={17} /></div><div><div className="text-[12px] font-bold text-[#d7e9df]">Pay with Wise</div><p className="mt-1 text-[10px] leading-[1.45] text-[#94b1a3]">Send $7 to the handle below, then keep the reference code.</p></div></div>
                <ArrowRight size={15} className="mt-1 text-[#8ec1a5]" />
              </div>
            </button>
          </Card>
          <Card tone="gold" className="cursor-pointer transition hover:border-[#b28b51]">
            <button onClick={() => setState('gift')} className="w-full text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#4b3a24] text-[#e7c982]"><Gift size={17} /></div><div><div className="text-[12px] font-bold text-[#f0ddb0]">Use a gift card code</div><p className="mt-1 text-[10px] leading-[1.45] text-[#bca982]">Enter a code when a bank transfer is not available.</p></div></div>
                <ArrowRight size={15} className="mt-1 text-[#d9b777]" />
              </div>
            </button>
          </Card>
          <button onClick={() => setState('recover')} className="flex w-full items-center justify-center gap-2 py-2 text-[10px] font-bold text-[#9bb4a8] hover:text-[#ddb077]"><Search size={13} />Lost a claim link?</button>
        </div>
      )}

      {state === 'wise' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={Banknote}>Wise route</SectionLabel>
          <Card tone="sage">
            <div className="flex items-center justify-between"><div className="text-[11px] font-bold text-[#d7e9df]">Send exactly</div><div className="serif text-[26px] text-[#b9dec9]">$7</div></div>
            <div className="mt-3 border-t border-[#385848] pt-3"><div className="mono text-[8px] uppercase tracking-[0.12em] text-[#829e91]">Wise handle</div><div className="mt-1 flex items-center justify-between text-[15px] font-bold text-[#e2efe8]">onepercent.pay <Copy size={13} className="text-[#8cbb9f]" /></div></div>
            <div className="mt-3 text-[10px] leading-[1.45] text-[#9ab7a8]">Use the reference in the note if the transfer form asks for one. The claim link appears after confirmation.</div>
          </Card>
          <PrimaryButton tone="sage" onClick={handOver} className="w-full"><Check size={14} />I sent $7</PrimaryButton>
          <button onClick={() => setState('route')} className="w-full py-2 text-[9px] font-bold text-[#80978e] hover:text-[#ddb077]">I need another route</button>
        </div>
      )}

      {state === 'gift' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={Gift}>Gift card route</SectionLabel>
          <Card tone="gold">
            <div className="flex items-center justify-between"><div className="text-[11px] font-bold text-[#f0ddb0]">Session value</div><div className="serif text-[26px] text-[#e7c982]">$7</div></div>
            <p className="mt-3 border-t border-[#584a31] pt-3 text-[10px] leading-[1.45] text-[#bca982]">The code is checked once. It is not stored in the reference code.</p>
          </Card>
          <Field label="Gift card code" value={giftCode} onChange={setGiftCode} placeholder="7H4K-2M8Q" />
          <PrimaryButton tone="gold" onClick={handOver} disabled={!giftCode.trim()} className="w-full"><Gift size={14} />Use code and continue</PrimaryButton>
          <button onClick={() => setState('route')} className="w-full py-2 text-[9px] font-bold text-[#80978e] hover:text-[#ddb077]">I need another route</button>
        </div>
      )}

      {state === 'handed' && (
        <div className="fade-in space-y-3">
          <Card tone="sage">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.11em] text-[#a9dfbf]"><Check size={14} />Payment recorded</div>
            <p className="mt-2 text-[11px] leading-[1.45] text-[#a8c6b6]">Keep both the reference and the claim link. They are the route back to the session without an account.</p>
          </Card>
          <SectionLabel icon={KeyRound}>reference code</SectionLabel>
          <CodeLine code="H8TF7-AFJYL" copyable onCopy={() => setMessage('Reference copied')} />
          <SectionLabel icon={ArrowRight}>claim link</SectionLabel>
          <CodeLine code="onepercent.co/s/H8TF7-AFJYL" copyable onCopy={() => setMessage('Claim link copied')} />
          {message && <div className="text-center text-[9px] font-bold text-[#a9dfbf]">{message}</div>}
          <PrimaryButton tone="gold" onClick={() => setState('route')} className="w-full">Start another purchase</PrimaryButton>
        </div>
      )}

      {state === 'recover' && (
        <div className="fade-in space-y-3">
          <BackLabel onClick={() => setState('route')}>back to payment</BackLabel>
          <SectionLabel icon={Search}>recover a session</SectionLabel>
          <p className="text-[11px] leading-[1.5] text-[#9bb1a8]">Use the reference code or the gift card code used for the purchase. A matching claim link is shown here.</p>
          <Field label="Reference or gift card code" value={reference} onChange={setReference} placeholder="H8TF7-AFJYL" />
          <PrimaryButton tone="coral" onClick={() => { setState('handed'); setMessage('Matching claim link found'); }} disabled={!reference.trim()} className="w-full"><Search size={14} />Find claim link</PrimaryButton>
          <Card><div className="flex gap-2 text-[10px] leading-[1.45] text-[#a6bbb3]"><KeyRound size={14} className="mt-0.5 shrink-0 text-[#d7b57f]" />No account or contact address is required to recover the purchase.</div></Card>
        </div>
      )}

      {state === 'empty' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={WalletCards}>no payment route available</SectionLabel>
          <Card tone="gold">
            <div className="text-[12px] font-bold text-[#f0ddb0]">There is no open route for this session.</div>
            <p className="mt-2 text-[10px] leading-[1.45] text-[#bca982]">The purchase cannot continue until Wise or a valid gift card route is available. No money has been taken.</p>
          </Card>
          <PrimaryButton tone="gold" onClick={() => setState('route')} className="w-full"><WalletCards size={14} />Show payment routes</PrimaryButton>
        </div>
      )}

      {state === 'failed' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={Search}>payment could not be recorded</SectionLabel>
          <AlertBox>The payment check did not complete. Keep the reference or gift card code, then try the same route again. Do not send a second Wise transfer until the first result is clear.</AlertBox>
          <Card><div className="flex items-center justify-between text-[10px] text-[#9fb5ab]"><span>session value</span><span className="serif text-[24px] text-[#e3c18a]">$7</span></div></Card>
          <PrimaryButton tone="coral" onClick={() => setState('route')} className="w-full"><Search size={14} />Try payment again</PrimaryButton>
          <button onClick={() => setState('recover')} className="w-full py-2 text-[9px] font-bold text-[#80978e] hover:text-[#ddb077]">Recover with a reference</button>
        </div>
      )}
    </PhoneShell>
  );
}