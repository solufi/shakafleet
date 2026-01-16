import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default function HomePage() {
  const jar = cookies();
  const session = jar.get("shaka_admin")?.value;

  if (!session) {
    redirect("/login");
  }

  return (
    <main style={{ maxWidth: 720, margin: "64px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Shaka Fleet</h1>
      <p style={{ marginTop: 0, color: "#555" }}>Logged in.</p>
    </main>
  );
}
