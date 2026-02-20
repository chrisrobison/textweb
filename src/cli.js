#!/usr/bin/env node

/**
 * TextWeb CLI - Command-line interface for text-grid web rendering
 */

const { AgentBrowser } = require('./browser');
const { createServer } = require('./server');
const readline = require('readline');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    url: null,
    interactive: false,
    json: false,
    serve: false,
    cols: 100,
    port: 3000,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--interactive':
      case '-i':
        options.interactive = true;
        break;
        
      case '--json':
      case '-j':
        options.json = true;
        break;
        
      case '--serve':
      case '-s':
        options.serve = true;
        break;
        
      case '--cols':
      case '-c':
        options.cols = parseInt(args[++i]) || 100;
        break;
        
      case '--rows':
      case '-r':
        // Deprecated: height is dynamic (grows to fit content). Ignored.
        console.error('Warning: --rows is deprecated. Height is dynamic (grows to fit content).');
        args[++i]; // consume the value
        break;
        
      case '--port':
      case '-p':
        options.port = parseInt(args[++i]) || 3000;
        break;
        
      case '--help':
      case '-h':
        options.help = true;
        break;
        
      default:
        if (!arg.startsWith('-') && !options.url) {
          options.url = arg;
        }
        break;
    }
  }

  return options;
}

// Show help message
function showHelp() {
  console.log(`
TextWeb - Text-grid web renderer for AI agents

USAGE:
  textweb <url>                    Render page and print to console
  textweb --interactive <url>      Start interactive REPL mode
  textweb --json <url>             Output as JSON (view + elements)
  textweb --serve                  Start HTTP API server

OPTIONS:
  --cols, -c <number>                Grid width in characters (default: 100)
  --rows, -r <number>                (deprecated, height is dynamic)
  --port, -p <number>                Server port (default: 3000)
  --interactive, -i                  Interactive REPL mode
  --json, -j                         JSON output format
  --serve, -s                        Start HTTP server
  --help, -h                         Show this help message

EXAMPLES:
  textweb https://example.com
  textweb --interactive https://github.com
  textweb --json --cols 120 https://news.ycombinator.com
  textweb --serve --port 8080

INTERACTIVE COMMANDS:
  click <ref>                        Click element by reference number
  type <ref> <text>                  Type text into input element
  scroll <direction> [amount]        Scroll (up/down/left/right)
  select <ref> <value>               Select dropdown option
  snapshot                           Re-render current page
  query <selector>                   Find elements by CSS selector
  region <r1> <c1> <r2> <c2>        Read text from grid region
  navigate <url>                     Navigate to new URL
  screenshot [filename]              Take screenshot (for debugging)
  help                               Show interactive commands
  quit, exit                         Exit interactive mode
`);
}

// Main render function
async function render(url, options) {
  const browser = new AgentBrowser({
    cols: options.cols,

    headless: true
  });

  try {
    console.error(`Rendering: ${url}`);
    const result = await browser.navigate(url);
    
    if (options.json) {
      console.log(JSON.stringify({
        view: result.view,
        elements: result.elements,
        meta: result.meta
      }, null, 2));
    } else {
      console.log(result.view);
      
      // Show element references
      const elCount = Object.keys(result.elements || {}).length;
      if (elCount > 0) {
        console.error(`\\nInteractive elements:`);
        for (const [ref, element] of Object.entries(result.elements || {})) {
          console.error(`[${ref}] ${element.semantic || element.tag}: ${element.text || '(no text)'}`);
        }
      }
    }
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// Interactive REPL mode
async function interactive(url, options) {
  const browser = new AgentBrowser({
    cols: options.cols,

    headless: true
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'textweb> '
  });

  let result = null;

  try {
    console.log(`Starting interactive session...`);
    if (url) {
      console.log(`Navigating to: ${url}`);
      result = await browser.navigate(url);
      console.log(result.view);
      console.log(`\\nElements: ${Object.keys(result.elements || {}).length} interactive elements found`);
    }
    
    console.log(`\\nType 'help' for commands, 'quit' to exit`);
    rl.prompt();

    rl.on('line', async (input) => {
      const parts = input.trim().split(/\\s+/);
      const command = parts[0].toLowerCase();
      
      try {
        switch (command) {
          case 'help':
            console.log(`
Interactive Commands:
  click <ref>                 Click element [ref]
  type <ref> <text>           Type text into element [ref]
  scroll <dir> [amount]       Scroll direction (up/down/left/right)
  select <ref> <value>        Select option in dropdown [ref]
  snapshot                    Re-render current page
  query <selector>            Find elements by CSS selector
  region <r1> <c1> <r2> <c2>  Read text from grid region
  navigate <url>              Navigate to new URL
  screenshot [file]           Take screenshot
  elements                    List all interactive elements
  url                         Show current URL
  clear                       Clear screen
  quit, exit                  Exit
`);
            break;
            
          case 'click':
            if (parts.length < 2) {
              console.log('Usage: click <ref>');
            } else {
              const ref = parseInt(parts[1]);
              result = await browser.click(ref);
              console.log(result.view);
            }
            break;
            
          case 'type':
            if (parts.length < 3) {
              console.log('Usage: type <ref> <text>');
            } else {
              const ref = parseInt(parts[1]);
              const text = parts.slice(2).join(' ');
              result = await browser.type(ref, text);
              console.log(result.view);
            }
            break;
            
          case 'upload':
            if (parts.length < 3) {
              console.log('Usage: upload <ref> <filepath> [filepath2 ...]');
            } else {
              const ref = parseInt(parts[1]);
              const files = parts.slice(2);
              result = await browser.upload(ref, files);
              console.log(result.view);
            }
            break;

          case 'scroll':
            if (parts.length < 2) {
              console.log('Usage: scroll <direction> [amount]');
            } else {
              const direction = parts[1];
              const amount = parseInt(parts[2]) || 5;
              result = await browser.scroll(direction, amount);
              console.log(result.view);
            }
            break;
            
          case 'select':
            if (parts.length < 3) {
              console.log('Usage: select <ref> <value>');
            } else {
              const ref = parseInt(parts[1]);
              const value = parts.slice(2).join(' ');
              result = await browser.select(ref, value);
              console.log(result.view);
            }
            break;
            
          case 'snapshot':
            result = await browser.snapshot();
            console.log(result.view);
            break;
            
          case 'query':
            if (parts.length < 2) {
              console.log('Usage: query <selector>');
            } else {
              const selector = parts[1];
              const matches = await browser.query(selector);
              console.log(`Found ${matches.length} matches:`);
              matches.forEach(match => {
                console.log(`[${match.ref}] ${match.tagName}: ${match.textContent || '(no text)'}`);
              });
            }
            break;
            
          case 'region':
            if (parts.length < 5) {
              console.log('Usage: region <r1> <c1> <r2> <c2>');
            } else {
              const r1 = parseInt(parts[1]);
              const c1 = parseInt(parts[2]);
              const r2 = parseInt(parts[3]);
              const c2 = parseInt(parts[4]);
              const text = browser.readRegion(r1, c1, r2, c2);
              console.log(`Region (${r1},${c1}) to (${r2},${c2}):`);
              console.log(text);
            }
            break;
            
          case 'navigate':
            if (parts.length < 2) {
              console.log('Usage: navigate <url>');
            } else {
              const newUrl = parts[1];
              console.log(`Navigating to: ${newUrl}`);
              result = await browser.navigate(newUrl);
              console.log(result.view);
            }
            break;
            
          case 'screenshot':
            const filename = parts[1] || 'screenshot.png';
            await browser.screenshot({ path: filename });
            console.log(`Screenshot saved to: ${filename}`);
            break;
            
          case 'elements':
            if (result && Object.keys(result.elements || {}).length > 0) {
              console.log(`Interactive elements (${Object.keys(result.elements || {}).length}):`);
              for (const [ref, element] of Object.entries(result.elements || {})) {
                console.log(`[${ref}] ${element.semantic || element.tag}: ${element.text || '(no text)'}`);
              }
            } else {
              console.log('No interactive elements found');
            }
            break;
            
          case 'url':
            console.log(`Current URL: ${browser.getCurrentUrl() || 'Not navigated'}`);
            break;
            
          case 'clear':
            console.clear();
            break;
            
          case 'quit':
          case 'exit':
            console.log('Goodbye!');
            rl.close();
            return;
            
          case '':
            // Empty command, just re-prompt
            break;
            
          default:
            console.log(`Unknown command: ${command}. Type 'help' for available commands.`);
            break;
        }
      } catch (error) {
        console.error(`Error: ${error.message}`);
      }
      
      rl.prompt();
    });

    rl.on('close', async () => {
      console.log('\\nClosing browser...');
      await browser.close();
      process.exit(0);
    });

  } catch (error) {
    console.error(`Error: ${error.message}`);
    await browser.close();
    process.exit(1);
  }
}

// Start HTTP server
async function serve(options) {
  console.log(`Starting TextWeb HTTP server on port ${options.port}...`);
  
  const server = createServer({
    cols: options.cols,

  });
  
  server.listen(options.port, () => {
    console.log(`TextWeb server running at http://localhost:${options.port}`);
    console.log(`\\nAPI Endpoints:`);
    console.log(`  POST /navigate   - Navigate to URL`);
    console.log(`  POST /click      - Click element`);
    console.log(`  POST /type       - Type text`);
    console.log(`  POST /scroll     - Scroll page`);
    console.log(`  POST /select     - Select dropdown option`);
    console.log(`  GET  /snapshot   - Get current state`);
    console.log(`  GET  /health     - Health check`);
  });
}

// Main entry point
async function main() {
  const options = parseArgs();
  
  if (options.help || (process.argv.length === 2)) {
    showHelp();
    return;
  }
  
  if (options.serve) {
    await serve(options);
  } else if (options.interactive) {
    await interactive(options.url, options);
  } else if (options.url) {
    await render(options.url, options);
  } else {
    console.error('Error: No URL provided or server mode selected');
    console.error('Use --help for usage information');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\\nShutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\\nShutting down...');
  process.exit(0);
});

// Run CLI
if (require.main === module) {
  main().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, render, interactive, serve };