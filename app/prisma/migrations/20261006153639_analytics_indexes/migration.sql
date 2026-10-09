CREATE INDEX "AnalyticsEvent_workspaceId_name_idx" ON "AnalyticsEvent"("workspaceId", "name");
CREATE INDEX "AnalyticsEvent_workspaceId_kind_contactId_idx" ON "AnalyticsEvent"("workspaceId", "kind", "contactId");
