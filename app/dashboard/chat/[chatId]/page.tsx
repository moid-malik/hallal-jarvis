import ChatInterface from "@/components/ChatInterface";
import { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

interface ChatPageProps {
  params: {
    chatId: Id<"chats">;
  };
}

export default async function ChatPage({ params }: ChatPageProps) {
  const { chatId } = params;

  // Get user authentication
  const { userId } = await auth();

  if (!userId) {
    redirect("/");
  }

  try {
    // Validate chat ID format
    if (!chatId || typeof chatId !== 'string' || !chatId.match(/^[a-zA-Z0-9_]+$/)) {
      console.error(`⚠️ Invalid chat ID format: ${chatId}`);
      redirect("/dashboard");
    }

    // Get Convex client and fetch chat and messages
    const convex = getConvexClient();

    // Check if chat exists & user is authorized to view it
    const chat = await convex.query(api.chats.getChat, {
      id: chatId,
      userId,
    });

    if (!chat) {
      console.error(
        `⚠️ Chat not found or unauthorized for ID: ${chatId}, user: ${userId}`
      );
      redirect("/dashboard");
    }

    // Get messages
    const initialMessages = await convex.query(api.messages.list, { chatId });
    console.log(`✅ Successfully loaded chat ${chatId} with ${initialMessages.length} messages`);

    return (
      <div className="flex-1 overflow-hidden">
        <ChatInterface chatId={chatId} initialMessages={initialMessages} />
      </div>
    );
  } catch (error) {
    console.error(`🔥 Error loading chat ${chatId}:`, error);
    redirect("/dashboard");
  }
}
