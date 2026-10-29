import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { SwaggerApiDocsSetupStep } from './swagger-api-docs-setup-step.js';

@Controller('things')
class ThingsController {
  @Get()
  list(): string[] {
    return [];
  }
}

describe('SwaggerApiDocsSetupStep', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('serves the OpenAPI document of the app routes and the Swagger UI under the configured path', async () => {
    const module = await Test.createTestingModule({ controllers: [ThingsController] }).compile();
    app = module.createNestApplication();
    new SwaggerApiDocsSetupStep({
      path: 'api-docs',
      title: 'a-title',
      description: 'a description',
    }).apply({
      app,
    });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();

    const ui = await fetch(new URL('/api-docs', base));
    const document = (await (await fetch(new URL('/api-docs-json', base))).json()) as {
      info: { title: string };
      paths: Record<string, unknown>;
    };

    expect(ui.status).toBe(200);
    expect(document.info.title).toBe('a-title');
    expect(Object.keys(document.paths)).toEqual(['/things']);
  });
});
