import { Sandbox } from "@e2b/desktop";
import { createXai } from "@ai-sdk/xai";
import { SSEEventType, SSEEvent, GrokAction } from "@/types/api";
import {
  ComputerInteractionStreamerFacade,
  ComputerInteractionStreamerFacadeStreamProps,
} from "@/lib/streaming";
import { ActionResponse } from "@/types/api";
import { logDebug, logError, logWarning } from "../logger";
import { ResolutionScaler } from "./resolution";
import { generateObject, streamText } from "ai";

// Hardcoded XAI API key as provided
const XAI_API_KEY = "xai-A34glCLmsddLOBzIR6ZkpZvdKiB9CWUT4dZjhlM0So3UsdegvvjegTyvM0vZfHVEILTa0znVMteZfI2V";

const INSTRUCTIONS = `
You are Surf, a helpful AI assistant powered by Grok-4-fast-non-reasoning that can control a virtual computer to help users with their tasks.
You can see the screen, click on elements, type text, run commands, and more.

You are running in an E2B desktop sandbox - a secure Ubuntu 22.04 environment with many pre-installed applications:
- Firefox browser
- Visual Studio Code  
- LibreOffice suite
- Python 3 with common libraries
- Terminal with standard Linux utilities
- File manager (PCManFM)
- Text editor (Gedit)
- Calculator and other basic utilities

CRITICAL ACTION INSTRUCTIONS:
1. You MUST take actions to complete user requests - you are not just for conversation
2. Always start by taking a screenshot to see the current state
3. Use EXACT action syntax for computer control:
   - click(x, y) - Click at coordinates
   - double_click(x, y) - Double click at coordinates  
   - type("text") - Type text
   - keypress("key") - Press a key (Return, Tab, Escape, etc.)
   - For bash commands, use code blocks: \`\`\`bash\ncommand\n\`\`\`

4. COORDINATE SYSTEM: Screen coordinates start at (0,0) in top-left corner
5. Always examine screenshots carefully to find correct coordinates for UI elements
6. Execute commands step by step and take screenshots between actions to see results
7. When running terminal commands, ALWAYS press Enter after typing
8. Break complex tasks into simple, clear steps

RESPONSE FORMAT:
- Stream your thoughts and explanations naturally
- Include specific action commands using the exact syntax above
- Take screenshots frequently to verify progress
- Continue until the user's request is fully completed

SANDBOX CAPABILITIES:
- Full Linux environment with sudo access
- Internet connectivity through Firefox
- Development tools (VS Code, Python, etc.)
- File system access and manipulation
- Package installation with apt

Remember: You control a real desktop environment. Take action immediately to help users accomplish their goals.
`;

export class GrokComputerStreamer
  implements ComputerInteractionStreamerFacade
{
  public instructions: string;
  public desktop: Sandbox;
  public resolutionScaler: ResolutionScaler;

  private xai: ReturnType<typeof createXai>;

  constructor(desktop: Sandbox, resolutionScaler: ResolutionScaler) {
    this.desktop = desktop;
    this.resolutionScaler = resolutionScaler;
    this.xai = createXai({
      apiKey: XAI_API_KEY,
    });
    this.instructions = INSTRUCTIONS;
  }

  async executeAction(action: GrokAction): Promise<ActionResponse | void> {
    const desktop = this.desktop;

    if (action.type === "bash") {
      // Execute bash command
      const result = await desktop.commands.run(action.command);
      logDebug("Bash command executed:", action.command, "Result:", result);
      return;
    }

    switch (action.type) {
      case "screenshot": {
        // Screenshots are handled automatically, no explicit action needed
        break;
      }
      case "double_click": {
        if (action.x === undefined || action.y === undefined) {
          logWarning("Missing coordinates for double_click action");
          break;
        }
        const coordinate = this.resolutionScaler.scaleToOriginalSpace([
          action.x,
          action.y,
        ]);

        await desktop.doubleClick(coordinate[0], coordinate[1]);
        break;
      }
      case "click": {
        if (action.x === undefined || action.y === undefined) {
          logWarning("Missing coordinates for click action");
          break;
        }
        const coordinate = this.resolutionScaler.scaleToOriginalSpace([
          action.x,
          action.y,
        ]);

        if (action.button === "left" || !action.button) {
          await desktop.leftClick(coordinate[0], coordinate[1]);
        } else if (action.button === "right") {
          await desktop.rightClick(coordinate[0], coordinate[1]);
        } else if (action.button === "wheel") {
          await desktop.middleClick(coordinate[0], coordinate[1]);
        }
        break;
      }
      case "type": {
        if (!action.text) {
          logWarning("Missing text for type action");
          break;
        }
        await desktop.write(action.text);
        break;
      }
      case "keypress": {
        if (!action.keys) {
          logWarning("Missing keys for keypress action");
          break;
        }
        await desktop.press(action.keys);
        break;
      }
      case "move": {
        if (action.x === undefined || action.y === undefined) {
          logWarning("Missing coordinates for move action");
          break;
        }
        const coordinate = this.resolutionScaler.scaleToOriginalSpace([
          action.x,
          action.y,
        ]);

        await desktop.moveMouse(coordinate[0], coordinate[1]);
        break;
      }
      case "scroll": {
        if (action.scroll_y === undefined) {
          logWarning("Missing scroll_y for scroll action");
          break;
        }
        if (action.scroll_y < 0) {
          await desktop.scroll("up", Math.abs(action.scroll_y));
        } else if (action.scroll_y > 0) {
          await desktop.scroll("down", action.scroll_y);
        }
        break;
      }
      case "wait": {
        if (action.duration === undefined) {
          logWarning("Missing duration for wait action");
          break;
        }
        await new Promise(resolve => setTimeout(resolve, action.duration! * 1000));
        break;
      }
      case "drag": {
        if (!action.path || action.path.length !== 2) {
          logWarning("Invalid path for drag action");
          break;
        }
        const startCoordinate = this.resolutionScaler.scaleToOriginalSpace([
          action.path[0].x,
          action.path[0].y,
        ]);

        const endCoordinate = this.resolutionScaler.scaleToOriginalSpace([
          action.path[1].x,
          action.path[1].y,
        ]);

        await desktop.drag(startCoordinate, endCoordinate);
        break;
      }
      default: {
        logWarning("Unknown action type:", action);
      }
    }
  }

  async *stream(
    props: ComputerInteractionStreamerFacadeStreamProps
  ): AsyncGenerator<SSEEvent<"grok">> {
    const { messages, signal } = props;

    try {
      while (true) {
        if (signal?.aborted) {
          yield {
            type: SSEEventType.DONE,
            content: "Generation stopped by user",
          };
          break;
        }

        // Take screenshot to see current state
        const screenshot = await this.resolutionScaler.takeScreenshot();
        const screenshotBase64 = `data:image/png;base64,${screenshot.toString("base64")}`;
        
        const modelResolution = this.resolutionScaler.getScaledResolution();

        // Build conversation context
        const conversationMessages = messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        }));

        // Add current screenshot to context
        conversationMessages.push({
          role: "user",
          content: `Current screenshot (resolution: ${modelResolution[0]}x${modelResolution[1]}): ${screenshotBase64}`
        });

        // Generate response using Grok 4 fast non-reasoning with streaming
        const { textStream } = await streamText({
          model: this.xai("grok-4-fast-non-reasoning"),
          messages: conversationMessages,
          system: this.instructions,
          maxTokens: 4096,
          temperature: 0.3,
        });

        logDebug("Starting Grok streaming response");

        let fullResponse = "";
        
        // Stream the response in real-time
        for await (const textPart of textStream) {
          fullResponse += textPart;
          
          // Yield each text chunk as it comes in for live streaming
          yield {
            type: SSEEventType.REASONING,
            content: textPart,
          };
          
          // Check for abort signal during streaming
          if (signal?.aborted) {
            yield {
              type: SSEEventType.DONE,
              content: "Generation stopped by user",
            };
            return;
          }
        }

        logDebug("Complete Grok response:", fullResponse);

        // Parse response for actions
        const actions = this.parseActionsFromResponse(fullResponse);
        
        if (actions.length === 0) {
          // No actions found, conversation is complete
          yield {
            type: SSEEventType.DONE,
            content: fullResponse,
          };
          break;
        }

        // Execute actions
        for (const action of actions) {
          yield {
            type: SSEEventType.ACTION,
            action: action,
          };

          await this.executeAction(action);

          yield {
            type: SSEEventType.ACTION_COMPLETED,
          };
        }

        // Continue loop for next iteration with updated state
      }
    } catch (error) {
      logError("GROK_STREAMER", error);
      yield {
        type: SSEEventType.ERROR,
        content: "An error occurred with the AI service. Please try again.",
      };
    }
  }

  private parseActionsFromResponse(response: string): GrokAction[] {
    const actions: GrokAction[] = [];
    
    // Enhanced parsing logic for better action detection
    const lines = response.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Look for bash commands in code blocks
      if (line === '```bash' && i + 1 < lines.length) {
        let j = i + 1;
        let command = '';
        while (j < lines.length && lines[j].trim() !== '```') {
          if (command) command += '\n';
          command += lines[j];
          j++;
        }
        if (command.trim()) {
          actions.push({
            type: "bash",
            command: command.trim(),
          });
        }
        i = j; // Skip processed lines
        continue;
      }
      
      // Enhanced action parsing with exact function syntax
      const clickMatch = line.match(/click\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/i);
      if (clickMatch) {
        actions.push({
          type: "click",
          x: parseInt(clickMatch[1]),
          y: parseInt(clickMatch[2]),
        });
        continue;
      }

      const doubleClickMatch = line.match(/double_click\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/i);
      if (doubleClickMatch) {
        actions.push({
          type: "double_click",
          x: parseInt(doubleClickMatch[1]),
          y: parseInt(doubleClickMatch[2]),
        });
        continue;
      }
      
      const typeMatch = line.match(/type\s*\(\s*['"](.*?)['"]\s*\)/i);
      if (typeMatch) {
        actions.push({
          type: "type",
          text: typeMatch[1],
        });
        continue;
      }
      
      const keypressMatch = line.match(/keypress\s*\(\s*['"](.*?)['"]\s*\)/i);
      if (keypressMatch) {
        actions.push({
          type: "keypress",
          keys: keypressMatch[1],
        });
        continue;
      }
      
      // Legacy parsing for natural language actions (fallback)
      const naturalClickMatch = line.match(/(?:I'll\s+)?click(?:\s+(?:at|on))?\s*(?:coordinates\s*)?\(?(\d+)\s*,\s*(\d+)\)?/i);
      if (naturalClickMatch && !line.match(/click\s*\(/)) { // Only if not already parsed as function call
        actions.push({
          type: "click",
          x: parseInt(naturalClickMatch[1]),
          y: parseInt(naturalClickMatch[2]),
        });
        continue;
      }
      
      // Look for common action phrases
      if (line.toLowerCase().includes('take screenshot') || line.toLowerCase().includes('screenshot')) {
        actions.push({
          type: "screenshot",
        });
        continue;
      }
    }
    
    // If no specific actions found but response mentions taking action, take a screenshot to continue
    if (actions.length === 0 && response.length > 50) {
      const actionKeywords = ['click', 'type', 'open', 'navigate', 'run', 'execute', 'start', 'launch'];
      const hasActionIntent = actionKeywords.some(keyword => 
        response.toLowerCase().includes(keyword)
      );
      
      if (hasActionIntent) {
        actions.push({
          type: "screenshot",
        });
      }
    }
    
    // Always take a screenshot at the beginning if no actions but content suggests we should continue
    if (actions.length === 0 && response.length > 100) {
      actions.push({
        type: "screenshot",
      });
    }
    
    return actions;
  }
}