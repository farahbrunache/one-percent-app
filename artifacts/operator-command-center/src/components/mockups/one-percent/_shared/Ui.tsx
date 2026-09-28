import type { ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  LockKeyhole,
  ShieldCheck,
  Timer,
} from 'lucide-react';

export const ink = {
  bg: '#0d1110',
  panel: '#151918',
  raised: '#1d2523',
  line: '#2c3c38',
  muted: '#7e958c',
  text: '#e6eee9',
  cream: '#f4eadb',
  gold: '#ddb077',
  coral: '#c96859',
  sage: '#83c1a6',
};

export function PhoneShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="one-percent min-h-[100dvh] overflow-x-hidden bg-[#0d1110] text-[#e6eee9]">
      <style>{`
        .one-percent { font-family:'DM Sans','Avenir Next',sans-serif; }
        .one-percent * { box-sizing:border-box; }
        .one-percent .serif { font-family:Georgia,'Times New Roman',serif; }
        .one-percent .mono { font-family:'IBM Plex Mono','SFMono-Regular',monospace; }
        .one-percent ::selection { background:#d09668; color:#171b1a; }
        .one-percent button,.one-percent input,.one-percent textarea { font:inherit; }
        .one-percent input:focus,.one-percent textarea:focus { outline:2px solid rgba(201,104,89,.72); outline-offset:1px; }
        .one-percent .scrollbar::-webkit-scrollbar { width:5px; height:5px; }
        .one-percent .scrollbar::-webkit-scrollbar-thumb { background:#3a4b47; border-radius:8px; }
        .one-percent .fade-in { animation:onePercentFade .26s ease-out both; }
        @keyframes onePercentFade { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
      <div className="min-h-[100dvh] bg-[#0d1110] md:px-6 md:py-6">
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col overflow-hidden border-x border-[#2b3a37] bg-[#151918] shadow-[0_20px_70px_rgba(0,0,0,.4)] md:min-h-[1050px] md:rounded-[28px] md:border md:shadow-[0_24px_90px_rgba(0,0,0,.5)]">
          <header className="shrink-0 border-b border-[#2a3a36] bg-[#171d1c] px-4 pb-4 pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mono mb-2 flex items-center gap-2 text-[8px] font-bold uppercase tracking-[0.18em] text-[#829991]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#ddb077]" />
                  {eyebrow}
                </div>
                <h1 className="serif text-[27px] leading-[1.02] tracking-[-0.045em] text-[#f4eadb]">{title}</h1>
                {subtitle && <p className="mt-2 max-w-[390px] text-[11px] leading-[1.5] text-[#91aaa1]">{subtitle}</p>}
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#ddb077] text-[13px] font-bold text-[#17201e]">1%</div>
            </div>
          </header>
          <main className="scrollbar min-h-0 flex-1 overflow-y-auto bg-[#151918] px-4 py-4">{children}</main>
          {footer && <footer className="shrink-0 border-t border-[#2a3a36] bg-[#171d1c] px-4 py-3">{footer}</footer>}
        </div>
      </div>
    </div>
  );
}

export function PreviewStates<T extends string>({
  label = 'Preview state',
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="mb-4 rounded-2xl border border-dashed border-[#40504b] bg-[#19211f] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="mono text-[8px] font-bold uppercase tracking-[0.15em] text-[#829991]">{label}</span>
        <span className="text-[9px] text-[#61766e]">design review only</span>
      </div>
      <div className="scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`whitespace-nowrap rounded-full px-2.5 py-1.5 text-[9px] font-bold transition ${value === option.value ? 'bg-[#ddb077] text-[#1b2521]' : 'bg-[#273632] text-[#9bb2a8] hover:bg-[#30443e]'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SectionLabel({ children, icon: Icon = ArrowRight }: { children: ReactNode; icon?: typeof ArrowRight }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em] text-[#829991]">
      <Icon size={13} strokeWidth={2.2} />
      {children}
    </div>
  );
}

export function Card({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'sage' | 'coral' | 'gold';
  className?: string;
}) {
  const tones = {
    neutral: 'border-[#2e403b] bg-[#1d2523]',
    sage: 'border-[#3d6452] bg-[#1d3028]',
    coral: 'border-[#65423d] bg-[#2b2421]',
    gold: 'border-[#6e5737] bg-[#2d281f]',
  };
  return <section className={`rounded-2xl border p-4 ${tones[tone]} ${className}`}>{children}</section>;
}

export function PrimaryButton({
  children,
  onClick,
  disabled = false,
  tone = 'coral',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'coral' | 'sage' | 'gold' | 'quiet';
  className?: string;
}) {
  const tones = {
    coral: 'bg-[#c96859] text-[#fff0e5] hover:bg-[#d77b6b]',
    sage: 'bg-[#498469] text-[#eff9f1] hover:bg-[#599a7a]',
    gold: 'bg-[#ddb077] text-[#1b2521] hover:bg-[#ebc28d]',
    quiet: 'border border-[#40534c] bg-[#202b28] text-[#b7ccc2] hover:border-[#668b79]',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.08em] transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  prefix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  prefix?: string;
}) {
  return (
    <label className="block">
      <span className="mono mb-1.5 block text-[8px] font-bold uppercase tracking-[0.13em] text-[#829991]">{label}</span>
      <div className="flex items-center rounded-xl border border-[#3b4d47] bg-[#202a27] px-3">
        {prefix && <span className="mr-1 text-[12px] text-[#d7b57f]">{prefix}</span>}
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-[12px] text-[#dce9e2] placeholder:text-[#647a72]"
        />
      </div>
    </label>
  );
}

export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'sage' | 'coral' | 'gold' }) {
  const tones = {
    neutral: 'border-[#455652] bg-[#273330] text-[#b3c4bd]',
    sage: 'border-[#39725b] bg-[#1c3e35] text-[#a9dfbf]',
    coral: 'border-[#70413e] bg-[#3b2929] text-[#e6a29a]',
    gold: 'border-[#765d2c] bg-[#3a3020] text-[#e7c982]',
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.06em] ${tones[tone]}`}>{children}</span>;
}

export function CodeLine({ code, copyable = false, onCopy }: { code: string; copyable?: boolean; onCopy?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#3c4d47] bg-[#111715] px-3 py-2.5">
      <span className="mono text-[12px] font-bold tracking-[0.08em] text-[#e4c08b]">{code}</span>
      {copyable && (
        <button onClick={onCopy} className="flex items-center gap-1 text-[9px] font-bold text-[#9fc1ad] hover:text-[#e7c982]">
          <Copy size={12} /> copy
        </button>
      )}
    </div>
  );
}

export function TrustLine({ children = 'Private reference · no account required' }: { children?: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-1.5 text-[9px] text-[#647a72]">
      <ShieldCheck size={11} /> {children}
    </div>
  );
}

export function CallTimer({ minutesLeft }: { minutesLeft: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[#65423d] bg-[#2b2421] px-3 py-3">
      <div className="flex items-center gap-2 text-[#e9a296]"><Timer size={15} /><span className="text-[10px] font-bold uppercase tracking-[0.1em]">call running</span></div>
      <div className="text-right"><div className="serif text-[24px] leading-none text-[#f4d2c7]">17:42</div><div className="mt-1 text-[9px] text-[#bd948b]">{minutesLeft} minutes left</div></div>
    </div>
  );
}

export function AlertBox({ children, tone = 'coral' }: { children: ReactNode; tone?: 'coral' | 'sage' | 'gold' }) {
  const tones = {
    coral: 'border-[#70413e] bg-[#3b2929] text-[#e7b0a5]',
    sage: 'border-[#3d6452] bg-[#1d3028] text-[#aed1bd]',
    gold: 'border-[#6e5737] bg-[#2d281f] text-[#e5ca93]',
  };
  return <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[10px] leading-[1.45] ${tones[tone]}`}><CircleAlert size={14} className="mt-0.5 shrink-0" />{children}</div>;
}

export function BackLabel({ onClick, children = 'back' }: { onClick?: () => void; children?: ReactNode }) {
  return <button onClick={onClick} className="mb-3 flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#8ca79a] hover:text-[#ddb077]"><ArrowLeft size={12} />{children}</button>;
}

export function CheckRow({ children, done = false }: { children: ReactNode; done?: boolean }) {
  return <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[10px] ${done ? 'border-[#365f4d] bg-[#1d3028] text-[#b7d5c2]' : 'border-[#344640] bg-[#1d2523] text-[#a8bbb3]'}`}><span className={`mt-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full ${done ? 'bg-[#70ae8f] text-[#17211d]' : 'border border-[#657a72]'}`}>{done && <Check size={10} strokeWidth={3} />}</span>{children}</div>;
}

export function PrivateFooter() {
  return <TrustLine><LockKeyhole size={11} />Access is tied to the reference code</TrustLine>;
}