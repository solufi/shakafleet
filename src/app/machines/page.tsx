import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

export default function MachinesPage() {
  const jar = cookies();
  const session = jar.get("shaka_admin")?.value;
  if (!session) redirect("/login");

  return (
    <main style={{ maxWidth: 720, margin: "64px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Machines</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        MVP placeholder. Next: enregistrer les machines, statut, dernières heartbeats, snapshots.
      </p>
      <p>
        <Link href="/">\u2190 Back</Link>
      </p>
    </main>
  );
}
