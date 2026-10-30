import { Body, Controller, Get, type INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createZodDto } from 'nestjs-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { SwaggerApiDocsSetupStep } from './swagger-api-docs-setup-step.js';

class CreateThingDto extends createZodDto(
  z.object({ name: z.string().min(1), size: z.number().int().optional() }),
) {}

@Controller('things')
class ThingsController {
  @Get()
  list(): string[] {
    return [];
  }

  @Post()
  create(@Body() body: CreateThingDto): CreateThingDto {
    return body;
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
      info: { title: string; description: string };
      paths: Record<string, unknown>;
    };

    expect(ui.status).toBe(200);
    expect(document.info.title).toBe('a-title');
    expect(document.info.description).toBe('a description');
    expect(Object.keys(document.paths)).toEqual(['/things']);
  });

  it('describes Zod DTOs with the properties of their schema', async () => {
    const module = await Test.createTestingModule({ controllers: [ThingsController] }).compile();
    app = module.createNestApplication();
    new SwaggerApiDocsSetupStep({ path: 'docs', title: 't', description: 'd' }).apply({ app });
    await app.listen(0, '127.0.0.1');

    const document = (await (await fetch(new URL('/docs-json', await app.getUrl()))).json()) as {
      components: {
        schemas: Record<string, { properties: Record<string, unknown>; required?: string[] }>;
      };
    };

    const schema = document.components.schemas.CreateThingDto;
    expect(Object.keys(schema?.properties ?? {})).toEqual(['name', 'size']);
    expect(schema?.required).toEqual(['name']);
    expect(JSON.stringify(document)).not.toContain('_ZodDto');
  });
});
