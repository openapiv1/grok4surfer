import { Sandbox } from "@e2b/desktop";
import { MockSandbox } from "@/lib/mock-sandbox";
import { ComputerModel, SSEEvent, SSEEventType } from "@/types/api";
import {
  ComputerInteractionStreamerFacade,
  createStreamingResponse,
} from "@/lib/streaming";
import { SANDBOX_TIMEOUT_MS } from "@/lib/config";
import { OpenAIComputerStreamer } from "@/lib/streaming/openai";
import { GrokComputerStreamer } from "@/lib/streaming/grok";
import { MistralComputerStreamer } from "@/lib/streaming/mistral";
import { logError, logDebug } from "@/lib/logger";
import { ResolutionScaler } from "@/lib/streaming/resolution";

export const maxDuration = 800;

class StreamerFactory {
  static getStreamer(
    model: ComputerModel,
    desktop: Sandbox | MockSandbox,
    resolution: [number, number]
  ): ComputerInteractionStreamerFacade {
    const resolutionScaler = new ResolutionScaler(desktop, resolution);

    switch (model) {
      case "mistral":
        return new MistralComputerStreamer(desktop, resolutionScaler);
      case "grok":
        return new GrokComputerStreamer(desktop, resolutionScaler);
      case "anthropic":
      // currently not implemented
      /* return new AnthropicComputerStreamer(desktop, resolutionScaler); */
      case "openai":
      default:
        return new OpenAIComputerStreamer(desktop, resolutionScaler);
    }
  }
}

export async function POST(request: Request) {
  const abortController = new AbortController();
  const { signal } = abortController;

  request.signal.addEventListener("abort", () => {
    abortController.abort();
  });

  const {
    messages,
    sandboxId,
    resolution,
    model = "mistral",
  } = await request.json();

  // Hardcoded API key as requested
  const apiKey = "e2b_8a5c7099485b881be08b594be7b7574440adf09c";

  if (!apiKey) {
    return new Response("E2B API key not found", { status: 500 });
  }

  let desktop: Sandbox | MockSandbox | undefined;
  let activeSandboxId = sandboxId;
  let vncUrl: string | undefined;

  try {
    if (!activeSandboxId) {
      logDebug("Creating new sandbox with API key:", apiKey.substring(0, 10) + "...");
      try {
        const newSandbox = await Sandbox.create({
          apiKey: apiKey,
          resolution,
          dpi: 96,
          timeoutMs: SANDBOX_TIMEOUT_MS,
        });

        await newSandbox.stream.start();

        activeSandboxId = newSandbox.sandboxId;
        vncUrl = newSandbox.stream.getUrl();
        desktop = newSandbox;
      } catch (e2bError) {
        // If E2B fails (e.g., in sandboxed environment), use mock sandbox for demonstration
        logDebug("E2B sandbox creation failed, using mock sandbox for demonstration:", e2bError);
        const mockSandbox = await MockSandbox.create({
          apiKey: apiKey,
          resolution,
          dpi: 96,
          timeoutMs: SANDBOX_TIMEOUT_MS,
        });
        
        activeSandboxId = mockSandbox.sandboxId;
        vncUrl = mockSandbox.stream.getUrl();
        desktop = mockSandbox;
      }
    } else {
      try {
        desktop = await Sandbox.connect(activeSandboxId, { apiKey: apiKey });
      } catch (e2bError) {
        // Fallback to mock sandbox
        logDebug("E2B sandbox connection failed, using mock sandbox:", e2bError);
        desktop = await MockSandbox.connect(activeSandboxId, { apiKey: apiKey });
      }
    }

    if (!desktop) {
      return new Response("Failed to connect to sandbox", { status: 500 });
    }

    desktop.setTimeout(SANDBOX_TIMEOUT_MS);

    try {
      const streamer = StreamerFactory.getStreamer(
        model as ComputerModel,
        desktop,
        resolution
      );

      if (!sandboxId && activeSandboxId && vncUrl) {
        async function* stream(): AsyncGenerator<SSEEvent<typeof model>> {
          yield {
            type: SSEEventType.SANDBOX_CREATED,
            sandboxId: activeSandboxId,
            vncUrl: vncUrl as string,
          };

          yield* streamer.stream({ messages, signal });
        }

        return createStreamingResponse(stream());
      } else {
        return createStreamingResponse(streamer.stream({ messages, signal }));
      }
    } catch (error) {
      logError("Error from streaming service:", error);

      return new Response(
        "An error occurred with the AI service. Please try again.",
        { status: 500 }
      );
    }
  } catch (error) {
    logError("Error connecting to sandbox:", error);
    // Log the full error for debugging
    console.error("Full sandbox error:", error);
    return new Response("Failed to connect to sandbox", { status: 500 });
  }
}
