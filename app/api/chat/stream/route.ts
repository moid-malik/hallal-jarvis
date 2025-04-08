import { submitQuestion } from "@/lib/langgraph";
import { api } from "@/convex/_generated/api";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { getConvexClient } from "@/lib/convex";
import {
  ChatRequestBody,
  StreamMessage,
  StreamMessageType,
  SSE_DATA_PREFIX,
  SSE_LINE_DELIMITER,
} from "@/lib/types";

// Important: These export configurations are critical for Edge API routes
export const runtime = "edge";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Helper function to send SSE messages
function sendSSEMessage(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  data: StreamMessage
) {
  try {
    const encoder = new TextEncoder();
    return writer.write(
      encoder.encode(
        `${SSE_DATA_PREFIX}${JSON.stringify(data)}${SSE_LINE_DELIMITER}`
      )
    );
  } catch (error) {
    console.error("Error in sendSSEMessage:", error);
    return Promise.resolve();
  }
}

// Handle all HTTP methods to prevent 405 errors
export async function GET(req: Request) {
  return NextResponse.json(
    { error: "Method not allowed, use POST" },
    { status: 405 }
  );
}

export async function PUT(req: Request) {
  return NextResponse.json(
    { error: "Method not allowed, use POST" },
    { status: 405 }
  );
}

export async function DELETE(req: Request) {
  return NextResponse.json(
    { error: "Method not allowed, use POST" },
    { status: 405 }
  );
}

export async function PATCH(req: Request) {
  return NextResponse.json(
    { error: "Method not allowed, use POST" },
    { status: 405 }
  );
}

export async function HEAD(req: Request) {
  return new Response(null, { status: 405 });
}

export async function OPTIONS(req: Request) {
  console.log("OPTIONS request received to /api/chat/stream");
  
  // Log request headers for debugging
  const headers = Object.fromEntries(req.headers.entries());
  console.log("OPTIONS request headers:", JSON.stringify(headers, null, 2));
  
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Max-Age": "86400",
      "Allow": "POST, OPTIONS, GET"
    }
  });
}

// Main handler for POST requests
export async function POST(req: Request) {
  console.log("POST request received to /api/chat/stream");
  
  // Log request headers for debugging
  const headers = Object.fromEntries(req.headers.entries());
  console.log("Request headers:", JSON.stringify(headers, null, 2));
  
  try {
    // Get user authentication
    const { userId } = await auth();
    if (!userId) {
      console.error("Authentication failed: No userId found");
      return NextResponse.json(
        { error: "Unauthorized" },
        { 
          status: 401,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization"
          }
        }
      );
    }

    // Parse request body
    const body = await req.json();
    const { messages, newMessage, chatId } = body as ChatRequestBody;
    
    console.log(`Processing chat request for chatId: ${chatId}`);

    // Initialize Convex client
    const convex = getConvexClient();
    
    // Create stream for SSE
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Start async processing
    (async () => {
      try {
        // Send connection established message
        await sendSSEMessage(writer, { type: StreamMessageType.Connected });

        // Save user message to Convex
        try {
          await convex.mutation(api.messages.send, {
            chatId,
            content: newMessage,
          });
        } catch (error) {
          console.error("Failed to save message to Convex:", error);
          // Continue even if saving fails
        }

        // Prepare messages for LangChain
        const langChainMessages = [
          ...messages.map((msg) =>
            msg.role === "user"
              ? new HumanMessage(msg.content)
              : new AIMessage(msg.content)
          ),
          new HumanMessage(newMessage),
        ];

        // Get response from LangGraph
        const eventStream = await submitQuestion(langChainMessages, chatId);
        
        // Process the response stream
        for await (const event of eventStream) {
          if (!event) continue;

          if (event.event === "on_chat_model_stream") {
            const token = event.data?.chunk;
            if (token && token.content) {
              let tokenText = "";
              
              if (typeof token.content === "string") {
                tokenText = token.content;
              } else if (Array.isArray(token.content) && token.content.length > 0) {
                const content = token.content[0];
                tokenText = typeof content === "object" && content.text 
                  ? content.text 
                  : String(content);
              }
              
              if (tokenText) {
                await sendSSEMessage(writer, {
                  type: StreamMessageType.Token,
                  token: tokenText,
                });
              }
            }
          }
        }

        // Send completion message
        await sendSSEMessage(writer, { type: StreamMessageType.Done });
      } catch (error) {
        console.error("Error in stream processing:", error);
        
        // Send error message
        await sendSSEMessage(writer, {
          type: StreamMessageType.Error,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        // Close the writer
        await writer.close().catch(console.error);
      }
    })();

    // Return the stream response
    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With"
      }
    });
  } catch (error) {
    console.error("Error in API route:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { 
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
          "Cache-Control": "no-cache, no-transform"
        }
      }
    );
  }
}
