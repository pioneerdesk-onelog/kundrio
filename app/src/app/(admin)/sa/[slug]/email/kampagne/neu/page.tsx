import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { NoAccess } from "@/components/users/NoAccess";
import { Card, PageHeader } from "@/components/ui";
import { Flash, type FlashParams } from "@/components/b/Flash";
import { saveCampaign } from "../../actions";
import { CampaignForm } from "../CampaignForm";
import { listOptions } from "@/lib/lists";

export default async function NewCampaign({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: FlashParams }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  if (!can(access, "email", "edit")) return <NoAccess what="das Anlegen von Kampagnen" />;
  const lists = await listOptions(ws.id);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Neue Kampagne" />
      <Flash {...await searchParams} />
      <Card><CampaignForm action={saveCampaign.bind(null, slug, null)} lists={lists} /></Card>
    </div>
  );
}
