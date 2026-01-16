import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

export default function HomePage() {
  const jar = cookies();
  const session = jar.get("shaka_admin")?.value;

  if (!session) {
    redirect("/login");
  }

  return (
    <main style={{ maxWidth: 720, margin: "64px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Shaka Fleet</h1>
      <p style={{ marginTop: 0, color: "#555" }}>Dashboard (MVP)</p>

      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <Link href="/machines">Machines</Link>
        <Link href="/agents">Agents</Link>
        <Link href="/api/health">Health (JSON)</Link>
        <Link href="/api/me">Me (JSON)</Link>
      </div>

      <form
        action="/api/auth/logout"
        method="post"
        style={{ marginTop: 24 }}
      >
        <button
          type="submit"
          style={{
            padding: 10,
            borderRadius: 8,
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Logout
        </button>
      </form>
    </main>
  );
}
