-- DropIndex

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "smsConsentAt" TIMESTAMP(3),
ADD COLUMN     "whatsappConsentAt" TIMESTAMP(3),
ADD COLUMN     "whatsappOptOutAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "bookingTokenHash" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'crm';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "dunnedAt" TIMESTAMP(3),
ADD COLUMN     "dunningLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentMethod" TEXT NOT NULL DEFAULT 'transfer',
ADD COLUMN     "subscriptionId" TEXT;

-- AlterTable
ALTER TABLE "MeetingType" ADD COLUMN     "availability" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "bookingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bookingSlug" TEXT,
ADD COLUMN     "confirmationText" TEXT,
ADD COLUMN     "hostUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "maxDaysAhead" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "minNoticeHours" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "questions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "slotIntervalMin" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "creditorId" TEXT;

-- CreateTable
CREATE TABLE "Inbox" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "credentials" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "contactId" TEXT,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "snoozedUntil" TIMESTAMP(3),
    "assigneeId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ticketId" TEXT,
    "threadKey" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unread" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "fromAddr" TEXT,
    "toAddrs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ccAddrs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "externalId" TEXT,
    "inReplyTo" TEXT,
    "references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'received',
    "error" TEXT,
    "sentById" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unitCents" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL DEFAULT 19,
    "interval" TEXT NOT NULL DEFAULT 'monthly',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "items" JSONB NOT NULL DEFAULT '[]',
    "interval" TEXT NOT NULL DEFAULT 'monthly',
    "startDate" DATE NOT NULL,
    "nextBillingDate" DATE NOT NULL,
    "minTermMonths" INTEGER NOT NULL DEFAULT 0,
    "noticePeriodDays" INTEGER NOT NULL DEFAULT 30,
    "cancelledAt" TIMESTAMP(3),
    "endDate" DATE,
    "paymentMethod" TEXT NOT NULL DEFAULT 'transfer',
    "mandateId" TEXT,
    "consumer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SepaMandate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "mandateRef" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "ibanEncrypted" TEXT NOT NULL,
    "ibanLast4" TEXT NOT NULL,
    "bic" TEXT,
    "scheme" TEXT NOT NULL DEFAULT 'CORE',
    "signedAt" DATE NOT NULL,
    "sequence" TEXT NOT NULL DEFAULT 'FRST',
    "status" TEXT NOT NULL DEFAULT 'active',
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "proofFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SepaMandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectDebitBatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "collectionDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL DEFAULT 0,
    "messageId" TEXT NOT NULL,
    "fileId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectDebitBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectDebitItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "sequence" TEXT NOT NULL,
    "endToEndId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "returnReason" TEXT,

    CONSTRAINT "DirectDebitItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Inbox_workspaceId_kind_address_key" ON "Inbox"("workspaceId", "kind", "address");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_status_lastMessageAt_idx" ON "Conversation"("workspaceId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_assigneeId_status_idx" ON "Conversation"("assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_inboxId_threadKey_key" ON "Conversation"("inboxId", "threadKey");

-- CreateIndex
CREATE INDEX "Message_workspaceId_createdAt_idx" ON "Message"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_externalId_key" ON "Message"("conversationId", "externalId");

-- CreateIndex
CREATE INDEX "Subscription_workspaceId_status_nextBillingDate_idx" ON "Subscription"("workspaceId", "status", "nextBillingDate");

-- CreateIndex
CREATE UNIQUE INDEX "SepaMandate_workspaceId_mandateRef_key" ON "SepaMandate"("workspaceId", "mandateRef");

-- CreateIndex
CREATE UNIQUE INDEX "DirectDebitBatch_messageId_key" ON "DirectDebitBatch"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectDebitItem_batchId_invoiceId_key" ON "DirectDebitItem"("batchId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_bookingTokenHash_key" ON "Event"("bookingTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingType_workspaceId_bookingSlug_key" ON "MeetingType"("workspaceId", "bookingSlug");

-- AddForeignKey
ALTER TABLE "Inbox" ADD CONSTRAINT "Inbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "SepaMandate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SepaMandate" ADD CONSTRAINT "SepaMandate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SepaMandate" ADD CONSTRAINT "SepaMandate_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectDebitBatch" ADD CONSTRAINT "DirectDebitBatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectDebitItem" ADD CONSTRAINT "DirectDebitItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DirectDebitBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectDebitItem" ADD CONSTRAINT "DirectDebitItem_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "SepaMandate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
