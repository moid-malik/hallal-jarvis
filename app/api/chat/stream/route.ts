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

export const runtime = "edge";

// Define allowed methods
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Explicitly define all HTTP methods
export async function GET() {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Allow': 'POST, OPTIONS'
    }
  });
}

// Add OPTIONS method to handle preflight requests
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Allow': 'POST, OPTIONS'
    },
  });
}

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
    // Return a resolved promise to prevent unhandled promise rejections
    return Promise.resolve();
  }
}

export async function POST(req: Request) {
  // Create a variable to hold the Convex client
  let convex;
  
  try {
    // Get user authentication
    const { userId } = await auth();
    
    // Better error handling for authentication
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    // Parse request body with error handling
    let requestBody: ChatRequestBody;
    try {
      requestBody = await req.json() as ChatRequestBody;
    } catch (error) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    const { messages, newMessage, chatId } = requestBody;
    
    // Get Convex client with error handling
    try {
      convex = getConvexClient();
    } catch (error) {
      console.error("Error initializing Convex client:", error);
      return new Response(JSON.stringify({ error: "Failed to initialize database connection" }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    // Verify that the Convex client has the mutation method
    if (!convex || typeof convex.mutation !== 'function') {
      console.error("Invalid Convex client:", { convex });
      return new Response(JSON.stringify({ error: "Database client is not properly initialized" }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    // Create stream with larger queue strategy for better performance
    const stream = new TransformStream({}, { highWaterMark: 1024 });
    const writer = stream.writable.getWriter();

    const response = new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no", // Disable buffering for nginx which is required for SSE to work properly
        "Access-Control-Allow-Origin": "*",
      },
    });

    // Handle the streaming response
    (async () => {
      try {
        // Send initial connection established message
        await sendSSEMessage(writer, { type: StreamMessageType.Connected });

        // Send user message to Convex with error handling
        try {
          // Double-check that convex.mutation is a function before calling it
          if (typeof convex.mutation === 'function') {
            await convex.mutation(api.messages.send, {
              chatId,
              content: newMessage,
            });
          } else {
            throw new Error("Convex mutation method is not available");
          }
        } catch (convexError) {
          console.error("Error sending message to Convex:", convexError);
          // Continue execution even if Convex save fails
        }

        // Convert messages to LangChain format with error handling
        const langChainMessages = [
          ...messages.map((msg) =>
            msg.role === "user"
              ? new HumanMessage(msg.content)
              : new AIMessage(msg.content)
          ),
          new HumanMessage(newMessage),
        ];

        try {
          // Create the event stream with error handling
          const eventStream = await submitQuestion(langChainMessages, chatId);
          
          if (!eventStream) {
            throw new Error("Failed to create event stream");
          }

          // Process the events
          for await (const event of eventStream) {
            // Skip null or undefined events
            if (!event) continue;

            if (event.event === "on_chat_model_stream") {
              const token = event.data?.chunk;
              if (token) {
                // Handle different content formats
                if (typeof token.content === 'string') {
                  // Direct string content
                  await sendSSEMessage(writer, {
                    type: StreamMessageType.Token,
                    token: token.content,
                  });
                } else if (Array.isArray(token.content)) {
                  // Array content format
                  if (token.content.length > 0) {
                    const content = token.content[0];
                    // Handle object with text property or direct string
                    const text = typeof content === 'object' ? content.text : content;
                    if (text) {
                      await sendSSEMessage(writer, {
                        type: StreamMessageType.Token,
                        token: text,
                      });
                    }
                  }
                }
              }
            } else if (event.event === "on_tool_start") {
              if (event.name && event.data?.input) {
                await sendSSEMessage(writer, {
                  type: StreamMessageType.ToolStart,
                  tool: event.name || "unknown",
                  input: event.data.input,
                });
              }
            } else if (event.event === "on_tool_end") {
              if (event.data?.output) {
                try {
                  const toolMessage = new ToolMessage(event.data.output);
                  const toolName = toolMessage.lc_kwargs?.name || "unknown";
                  await sendSSEMessage(writer, {
                    type: StreamMessageType.ToolEnd,
                    tool: toolName,
                    output: event.data.output,
                  });
                } catch (toolError) {
                  console.error("Error processing tool message:", toolError);
                  // Continue execution even if tool message processing fails
                }
              }
            }
          }

          // Send completion message without storing the response
          await sendSSEMessage(writer, { type: StreamMessageType.Done });
        } catch (streamError) {
          console.error("Error in event stream:", streamError);
          const errorMessage = streamError instanceof Error ? streamError.message : "Stream processing failed";
          
          // Log detailed error for debugging
          console.error("Stream error details:", {
            error: streamError,
            chatId,
            messageCount: messages.length,
          });
          
          // Send error message to client
          try {
            await sendSSEMessage(writer, {
              type: StreamMessageType.Error,
              error: errorMessage,
            });
          } catch (sendError) {
            console.error("Failed to send error message:", sendError);
          }
          
          // Store error in Convex for tracking
          try {
            if (convex && typeof convex.mutation === 'function') {
              await convex.mutation(api.messages.store, {
                chatId,
                content: `Error processing message: ${errorMessage}`,
                role: "assistant",
              });
            } else {
              console.warn("Skipping error storage: Convex client not available");
            }
          } catch (storeError) {
            console.error("Failed to store error message:", storeError);
          }
        }
      } catch (error) {
        console.error("Error in stream:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        
        // Log detailed error for debugging
        console.error("Stream processing error details:", {
          error,
          chatId,
        });
        
        // Send error message to client
        try {
          await sendSSEMessage(writer, {
            type: StreamMessageType.Error,
            error: errorMessage,
          });
        } catch (sendError) {
          console.error("Failed to send error message:", sendError);
        }
      } finally {
        try {
          if (writer && typeof writer.close === 'function') {
            await writer.close();
          }
        } catch (closeError) {
          console.error("Error closing writer:", closeError);
        }
      }
    })();

    return response;
  } catch (error) {
    console.error("Error in chat API:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to process chat request";
    
    // Log detailed error for debugging
    console.error("Chat API error details:", { error });
    
    return NextResponse.json(
      { error: errorMessage },
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        }
      }
    );
  }
}
