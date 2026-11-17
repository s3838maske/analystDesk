import { redirect } from "next/navigation";
import { getUser, login } from "@/server/auth";
import { audit } from "@/server/audit";
import { IconArrowRight, Logo } from "@/components/icons";

async function doLogin(formData: FormData) {
  "use server";
  const u = await login(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
  if (!u) redirect("/login?error=1");
  await audit(u, "LOGIN", "User", u.id, {});
  redirect("/");
}

const FACTS = [
  ["First draft", <>20 h → <span className="text-blue-700">6–9 h</span></>, "Pilot target", true],
  ["Every number", "Traced to source", "File, cell and formula", false],
  ["Change request", "Re-run in minutes", "Model and report together", false],
] as const;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getUser()) redirect("/");
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen flex-wrap bg-[#0b1020]">
      <section
        aria-label="About AnalystDesk"
        className="flex grow basis-[560px] flex-col gap-10 border-r border-gray-200 bg-[#0e1527] px-8 py-12 sm:px-14"
        style={{ backgroundImage: "linear-gradient(#151d33 1px, transparent 1px), linear-gradient(90deg, #151d33 1px, transparent 1px)", backgroundSize: "48px 48px" }}
      >
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <span className="font-[family-name:var(--font-display)] text-[22px] font-bold tracking-tight">AnalystDesk</span>
        </div>
        <div className="mt-6 flex max-w-[600px] flex-col gap-5">
          <span className="self-start rounded-full border border-[#3b4799] bg-purple-50 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-purple-700">Built for research teams</span>
          <h2 className="font-[family-name:var(--font-display)] text-5xl font-extrabold leading-[1.04] tracking-[-0.03em] sm:text-6xl">
            Analysis in <span className="text-blue-700">hours</span>,<br />not days.
          </h2>
          <p className="text-lg leading-relaxed text-gray-600">Upload the data you already have. AnalystDesk checks it, builds the ratios, the model and a first draft. You make every call.</p>
        </div>
        <div className="flex flex-wrap gap-3.5">
          {FACTS.map(([k, v, s, mono]) => (
            <div key={k} className="flex-[1_1_170px] rounded-2xl border border-gray-200 bg-white/90 p-4">
              <p className="eyebrow">{k}</p>
              <p className={`mt-2 mb-1 font-semibold ${mono ? "mono text-[22px]" : "font-[family-name:var(--font-display)] text-xl font-bold"}`}>{v}</p>
              <p className="text-[13px] text-gray-500">{s}</p>
            </div>
          ))}
        </div>
      </section>
      <main className="flex grow basis-[440px] items-center justify-center px-8 py-12">
        <div className="flex w-full max-w-[420px] flex-col gap-7">
          <div className="flex flex-col gap-2">
            <h1 className="font-[family-name:var(--font-display)] text-[34px] font-bold tracking-tight">Welcome back</h1>
            <p className="text-[15px] text-gray-500">Sign in to your team&apos;s AnalystDesk workspace.</p>
          </div>
          {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">Email or password is wrong.</p>}
          <form action={doLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-[13px] font-semibold text-gray-700">Work email</label>
              <input id="email" name="email" type="email" autoComplete="username" required placeholder="name@company.com" className="input h-[50px] px-4 text-[15px]" />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-[13px] font-semibold text-gray-700">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required placeholder="Your password" className="input h-[50px] px-4 text-[15px]" />
            </div>
            <button className="btn mt-1 h-[52px] text-base">Sign in <IconArrowRight /></button>
          </form>
          <p className="text-xs text-gray-500">Internal use only. Sign-ins and actions are recorded in the audit trail. Forgot your password? Ask your team admin.</p>
        </div>
      </main>
    </div>
  );
}
