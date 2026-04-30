import {
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { promises as fs } from 'fs';
import { resolve, isAbsolute, basename } from 'path';
import { Public } from '../auth/public.decorator.js';

// In-product API documentation surface.
//
// Routes (all under the global prefix `api/v1`):
//   GET /docs            — index page listing every domain spec
//   GET /docs/:spec      — Redoc UI for the named spec (loads YAML via the
//                           raw endpoint below)
//   GET /docs/specs/:f   — raw YAML, served verbatim from packages/openapi
//
// Specs come from `OPENAPI_SPECS_DIR` (default: `<repo>/packages/openapi`).
// In dev the openapi directory is mounted into the container; in production
// the Dockerfile copies it into the image.
//
// The whole surface is unauthenticated — the same pattern shipped in F11.6
// for the `/health` endpoint. Public docs of public APIs do not need a JWT.

const SPEC_FILES = [
  'access',
  'agents',
  'connectors',
  'consent',
  'governance',
  'invitations',
  'marketplace',
  'notifications',
  'organizations',
  'products',
  'slo',
  'trust-score',
] as const;

type SpecName = (typeof SPEC_FILES)[number];

const SPEC_DESCRIPTIONS: Record<SpecName, string> = {
  access:        'Access grants, access requests, and approval workflows.',
  agents:        'AI agent registration, classification, and oversight.',
  connectors:    'Source-system connector framework and discovery engine.',
  consent:       'Per-use-case connection references (Domain 12).',
  governance:    'Policy authoring, evaluation, exceptions, and compliance.',
  invitations:   'Org-level invitation flow for new principals.',
  marketplace:   'Public marketplace search, browse, and product detail.',
  notifications: 'In-platform notifications, preferences, and delivery.',
  organizations: 'Organizations, domains, principals, and role assignments.',
  products:      'Data product authoring, port declarations, and lifecycle.',
  slo:           'SLO declarations, evaluations, and trust-score drivers.',
  'trust-score': 'Trust score computation and history.',
};

@Controller('docs')
export class DocsController {
  private readonly logger = new Logger(DocsController.name);
  private readonly specsDir: string;

  constructor() {
    // OPENAPI_SPECS_DIR overrides the default for testing or unusual layouts.
    // The default resolves relative to the api package — `apps/api/dist/...`
    // at runtime in dev (--watch) and prod (compiled) — and walks up to the
    // monorepo root to find packages/openapi.
    const fromEnv = process.env.OPENAPI_SPECS_DIR;
    if (fromEnv && isAbsolute(fromEnv)) {
      this.specsDir = fromEnv;
    } else {
      this.specsDir = resolve(process.cwd(), '..', '..', 'packages', 'openapi');
    }
  }

  @Public()
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  index(): string {
    const items = SPEC_FILES.map((name) => {
      const description = SPEC_DESCRIPTIONS[name];
      const title = humanize(name);
      return `<li><a href="/api/v1/docs/${escapeHtml(name)}"><strong>${escapeHtml(title)}</strong></a><br><span class="desc">${escapeHtml(description)}</span></li>`;
    }).join('\n      ');

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Provenance API Reference</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      :root { color-scheme: light; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
             max-width: 760px; margin: 3rem auto; padding: 0 1.25rem; line-height: 1.5;
             color: #1f2937; }
      h1   { font-size: 1.6rem; margin-bottom: 0.25rem; }
      p.lede { color: #4b5563; margin-top: 0; }
      ul   { list-style: none; padding: 0; }
      li   { padding: 0.85rem 0; border-bottom: 1px solid #e5e7eb; }
      li:last-child { border-bottom: none; }
      a    { color: #1e40af; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .desc { color: #6b7280; font-size: 0.9rem; }
      footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid #e5e7eb;
               color: #6b7280; font-size: 0.85rem; }
    </style>
  </head>
  <body>
    <h1>Provenance API Reference</h1>
    <p class="lede">OpenAPI 3.1 specifications for every Provenance control-plane domain. Each link below opens a rendered reference; the raw YAML is available under <code>/api/v1/docs/specs/&lt;name&gt;.yaml</code>.</p>
    <ul>
      ${items}
    </ul>
    <footer>
      Source of truth: <code>packages/openapi/</code>. Specs are read at request time, so updates to a YAML are visible without an API restart.
    </footer>
  </body>
</html>`;
  }

  @Public()
  @Get(':spec')
  @Header('Content-Type', 'text/html; charset=utf-8')
  spec(@Param('spec') spec: string): string {
    const name = ensureKnownSpec(spec);
    const title = humanize(name);
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Provenance — ${escapeHtml(title)} API</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <redoc spec-url="/api/v1/docs/specs/${escapeHtml(name)}.yaml" hide-loading></redoc>
    <script src="https://cdn.redocly.com/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`;
  }

  @Public()
  @Get('specs/:file')
  @Header('Content-Type', 'application/yaml; charset=utf-8')
  async raw(@Param('file') file: string, @Res() res: Response): Promise<void> {
    if (!file.endsWith('.yaml')) {
      throw new HttpException('Spec must be requested as <name>.yaml', HttpStatus.NOT_FOUND);
    }
    const name = file.slice(0, -'.yaml'.length);
    ensureKnownSpec(name);

    // basename() strips any traversal attempt; SPEC_FILES check above already
    // rejects unknown names — defense in depth.
    const safeName = basename(name);
    const path = resolve(this.specsDir, `${safeName}.yaml`);

    try {
      const body = await fs.readFile(path, 'utf-8');
      res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
      res.send(body);
    } catch (err) {
      this.logger.warn(
        `OpenAPI spec ${name}.yaml not readable from ${this.specsDir}: ${(err as Error).message}`,
      );
      throw new HttpException(
        `Spec ${name} not available — packages/openapi is not mounted into this container.`,
        HttpStatus.NOT_FOUND,
      );
    }
  }
}

function ensureKnownSpec(name: string): SpecName {
  if (!(SPEC_FILES as readonly string[]).includes(name)) {
    throw new HttpException(`Unknown spec '${name}'`, HttpStatus.NOT_FOUND);
  }
  return name as SpecName;
}

function humanize(name: string): string {
  return name
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
