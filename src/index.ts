
// import { config, client, createClient, modelRouter , TelemetryEvents, telemetry } from '@santex/ollama-spaceship-sdk';

import { ClientLibrary } from './apis/ClientLibrary.js';
import { config ,client, createClient } from './apis/client.js';

function getLib() { return new ClientLibrary(); }





export async function test() {
  try {
    // access a client
    console.log('Creating a new client instance');
    console.log(client);
    
    // access a ClientLibrary
    console.log('Creating a new ClientLibrary instance');    
    const lib = new ClientLibrary();
    

    const userPrompt = 'create an ultra smart inventory system managing projects and other relevant actors required for successful ocean cleanup, create elasticsearch indices the indices need be able to be reduced by geo-search + vector search + user query , and an array of project  scores like funding, members, efficency, avg turnout in tonnes  many as possible! locations funding project score in terms time,cost, technology consider that ';

    console.log({'userPrompt':userPrompt});

    client.streamResponse('chat', userPrompt).subscribe({
      next(chunk) { 
        for (const [key, value] of Object.entries(chunk)) {
          console.log(`${key}: ${value}`);
        }
      },
      error(err)  { console.error(err); },
      complete(summary) { console.log(summary); },
    });

    const enhanced = await client.promptRouter.enhance(userPrompt, {
      TaskType: 'chat',
      Speed: 100,
      defaultModel: 'qwen3:0.6b',
      persona: {
        name: 'Marine Biologist',
        description: 'Expert in ocean ecosystems',
        instructions: 'Use scientific terminology',
      },
      temperature: 0.7,
      maxTokens: 4096
    });

    console.log({'enhanced prompt':enhanced});

    const stream = lib.stream('chat',enhanced);
    stream.subscribe({
      next(chunk) { console.log(chunk); },
      error(err)  { console.error(err); },
      complete(summary) { console.log(summary); },
    });

    // Entity CRUD via Elasticsearch
    const personas = await lib.entities.Persona.list('-created_date', 20);
    console.log({'personas':personas});
    
    const newPersona = await lib.entities.Persona.create({ name: 'Expert', description: '...' });
    console.log({'newPersona':newPersona});


    
        
    // Structured JSON output
    const data = await lib.invoke({
      prompt: 'List the top 10 ocean species most threatened by plastic polution, write a short description how they threatened to each animal',
      response_json_schema: {
        type: 'object',
        properties: { animals: { type: 'array', items: { type: 'object' } } }
      },
    });

    console.log({'structured output':data.animals});

        // Depth levls
    const levels = await client.integrations.Core.thinkingLevels(enhanced);

    console.log({'levels':levels});

    
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

export * from './apis/ClientLibrary.js';
export * from './apis/client.js';

// test();
