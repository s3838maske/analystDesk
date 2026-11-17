import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { hashPassword, requireUser, ROLES, ROLE_LABEL, Role } from "@/server/auth";
import { audit } from "@/server/audit";
import { Notice } from "@/components/ui";

async function createUser(formData: FormData) {
  "use server";
  const admin = await requireUser(["ADMIN"]);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role")) as Role;
  const password = String(formData.get("password") ?? "");
  if (!email || !name || !ROLES.includes(role)) redirect("/admin/users?err=Fill+in+every+field");
  if (password.length < 10) redirect("/admin/users?err=Temporary+password+must+be+at+least+10+characters");
  if (await prisma.user.findUnique({ where: { email } })) redirect("/admin/users?err=That+email+already+has+an+account");
  const u = await prisma.user.create({ data: { email, name, role, passwordHash: await hashPassword(password) } });
  await audit(admin, "USER_CREATED", "User", u.id, { email, name, role });
  redirect("/admin/users?msg=User+created");
}

async function updateUser(userId: string, formData: FormData) {
  "use server";
  const admin = await requireUser(["ADMIN"]);
  const role = String(formData.get("role")) as Role;
  const active = formData.get("active") === "on";
  if (!ROLES.includes(role)) redirect("/admin/users?err=Bad+role");
  if (userId === admin.id && (!active || role !== "ADMIN")) redirect("/admin/users?err=You+cannot+remove+your+own+admin+access");
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await prisma.user.update({ where: { id: userId }, data: { role, active } });
  if (!active) await prisma.session.deleteMany({ where: { userId } });
  await audit(admin, "USER_UPDATED", "User", userId, { before: { role: before.role, active: before.active }, after: { role, active } });
  redirect("/admin/users?msg=Saved");
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const users = await prisma.user.findMany({ orderBy: { name: "asc" } });
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="h1">Users and roles</h1>
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {sp.err && <Notice kind="error">{sp.err}</Notice>}
      <div className="card p-0">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td colSpan={3}>
                  <form action={updateUser.bind(null, u.id)} className="flex items-center gap-3">
                    <select className="input w-48" name="role" defaultValue={u.role}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                    <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="active" defaultChecked={u.active} /> active</label>
                    <button className="btn-secondary">Save</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form action={createUser} className="card grid grid-cols-2 gap-3">
        <h2 className="h2 col-span-2">Add user</h2>
        <div><label className="label">Name</label><input className="input" name="name" required /></div>
        <div><label className="label">Email</label><input className="input" name="email" type="email" required /></div>
        <div><label className="label">Role</label><select className="input" name="role">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
        <div><label className="label">Temporary password (share it privately)</label><input className="input" name="password" type="password" minLength={10} required /></div>
        <div className="col-span-2"><button className="btn">Create user</button></div>
      </form>
    </div>
  );
}
