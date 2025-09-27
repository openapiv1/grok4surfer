import { Sandbox } from "@e2b/desktop";
import { MockSandbox } from "@/lib/mock-sandbox";
import { createXai } from "@ai-sdk/xai";
import { SSEEventType, SSEEvent, GrokAction } from "@/types/api";
import {
  ComputerInteractionStreamerFacade,
  ComputerInteractionStreamerFacadeStreamProps,
} from "@/lib/streaming";
import { ActionResponse } from "@/types/api";
import { logDebug, logError, logWarning } from "../logger";
import { ResolutionScaler } from "./resolution";
import { generateObject, generateText } from "ai";

// Hardcoded XAI API key
const XAI_API_KEY = "xai-A34glCLmsddLOBzIR6ZkpZvdKiB9CWUT4dZjhlM0So3UsdegvvjegTyvM0vZfHVEILTa0znVMteZfI2V";

const INSTRUCTIONS = `
You are Surf, a helpful AI assistant powered by Grok that can control a virtual computer to help users with their tasks.
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

IMPORTANT CONTROL INSTRUCTIONS:
1. You can see the current screen state through screenshots
2. To interact with the computer, describe your actions clearly and use these formats:
   - For clicking: "I'll click at coordinates (x, y)" or "click(x, y)"
   - For typing: "I'll type 'text here'" or "type('text here')"  
   - For key presses: "I'll press Enter" or "keypress('Return')"
   - For bash commands: Use code blocks with bash language identifier

3. ALWAYS take a screenshot first to see the current state
4. Be specific about coordinates when clicking - examine the screenshot carefully
5. When running terminal commands, ALWAYS press Enter after typing the command
6. Explain what you're doing and why as you work through tasks
7. Break complex tasks into simple, clear steps

COORDINATE SYSTEM:
- The screen coordinates start at (0,0) in the top-left corner
- X increases to the right, Y increases downward
- Always examine the screenshot to find the correct coordinates for UI elements

BASH COMMANDS:
- You can run any Linux command in the terminal
- Use appropriate commands for the task (ls, cd, mkdir, cp, mv, etc.)
- Install packages with apt if needed (you have sudo access)
- Run Python scripts, compile code, etc.

Remember: You are controlling a real desktop environment. Take screenshots to understand the current state, then take appropriate actions to complete the user's request.
`;

export class GrokComputerStreamer
  implements ComputerInteractionStreamerFacade
{
  public instructions: string;
  public desktop: Sandbox | MockSandbox;
  public resolutionScaler: ResolutionScaler;

  private xai: ReturnType<typeof createXai>;

  constructor(desktop: Sandbox | MockSandbox, resolutionScaler: ResolutionScaler) {
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

        // Generate response using Grok
        const { text: response } = await generateText({
          model: this.xai("grok-2-1212"),
          messages: conversationMessages,
          system: this.instructions,
          maxTokens: 4096,
          temperature: 0.3,
        });

        logDebug("Grok response:", response);

        // Yield reasoning content
        if (response) {
          yield {
            type: SSEEventType.REASONING,
            content: response,
          };
        }

        // Parse response for actions
        const actions = this.parseActionsFromResponse(response);
        
        if (actions.length === 0) {
          // No actions found, conversation is complete
          yield {
            type: SSEEventType.DONE,
            content: response,
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
      
      // Look for action commands in text
      const clickMatch = line.match(/click(?:\s+(?:at|on))?\s*\(?(\d+)\s*,\s*(\d+)\)?/i);
      if (clickMatch) {
        actions.push({
          type: "click",
          x: parseInt(clickMatch[1]),
          y: parseInt(clickMatch[2]),
        });
        continue;
      }
      
      const typeMatch = line.match(/type\s*\(?\s*['"](.*?)['"]\s*\)?/i);
      if (typeMatch) {
        actions.push({
          type: "type",
          text: typeMatch[1],
        });
        continue;
      }
      
      const keypressMatch = line.match(/(?:press|keypress)\s*\(?\s*['"](.*?)['"]\s*\)?/i);
      if (keypressMatch) {
        actions.push({
          type: "keypress",
          keys: keypressMatch[1],
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
      
      if (line.toLowerCase().includes('double click') || line.toLowerCase().includes('double-click')) {
        const coords = line.match(/(\d+)\s*,\s*(\d+)/);
        if (coords) {
          actions.push({
            type: "double_click",
            x: parseInt(coords[1]),
            y: parseInt(coords[2]),
          });
        }
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
    
    return actions;
  }
}