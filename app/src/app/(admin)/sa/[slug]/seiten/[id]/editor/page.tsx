import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { NoAccess } from "@/components/users/NoAccess";
import { buildPageMeta } from "@/lib/p-meta";
import { saveDraft } from "../../actions";
import { Editor } from "./Editor";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { ws, access } = await pageAccess(slug);
  if (!can(access, "pages", "edit")) return <NoAccess what="den Seiten-Editor" />;
  const page = await db.landingPage.findFirst({ where: { id, workspaceId: ws.id } });
  if (!page) notFound();
  const meta = await buildPageMeta(ws, page);
  const forms = Object.entries(meta.forms).map(([fid, f]) => ({ id: fid, name: f.name }));
  return (
    <Editor
      title={page.title}
      data={page.data as object}
      meta={meta}
      forms={forms}
      save={saveDraft.bind(null, slug, page.id)}
      backHref={`/sa/${slug}/seiten/${page.id}`}
    />
  );
}
