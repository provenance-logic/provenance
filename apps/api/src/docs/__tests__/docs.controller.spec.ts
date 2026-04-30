import { Test } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { DocsController } from '../docs.controller.js';

describe('DocsController', () => {
  let controller: DocsController;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'provenance-openapi-'));
    // Write minimal stub specs so `raw()` has something to read.
    await writeFile(
      join(tempDir, 'organizations.yaml'),
      'openapi: 3.1.0\ninfo:\n  title: Test\n  version: 1.0.0\n',
      'utf-8',
    );
    process.env.OPENAPI_SPECS_DIR = tempDir;
  });

  afterAll(async () => {
    delete process.env.OPENAPI_SPECS_DIR;
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DocsController],
    }).compile();
    controller = moduleRef.get(DocsController);
  });

  describe('GET /docs (index)', () => {
    it('returns HTML listing every domain spec', () => {
      const html = controller.index();

      expect(html).toContain('<title>Provenance API Reference</title>');
      // Spot check a handful of expected entries.
      for (const expected of ['organizations', 'products', 'governance', 'consent', 'agents']) {
        expect(html).toContain(`/api/v1/docs/${expected}`);
      }
      // The page documents how to read raw YAML.
      expect(html).toContain('/api/v1/docs/specs/');
    });
  });

  describe('GET /docs/:spec (Redoc page)', () => {
    it('renders a Redoc page that loads the spec from the raw endpoint', () => {
      const html = controller.spec('organizations');

      expect(html).toContain(
        'spec-url="/api/v1/docs/specs/organizations.yaml"',
      );
      expect(html).toContain(
        'cdn.redocly.com/redoc/latest/bundles/redoc.standalone.js',
      );
      // Title is humanized — "trust-score" should render as "Trust Score".
      expect(controller.spec('trust-score')).toContain('Trust Score API');
    });

    it('rejects an unknown spec name', () => {
      expect(() => controller.spec('nonsense')).toThrow(HttpException);
    });

    it('refuses path traversal attempts in the spec name', () => {
      expect(() => controller.spec('../../../etc/passwd')).toThrow(HttpException);
    });
  });

  describe('GET /docs/specs/:file (raw YAML)', () => {
    it('serves the raw spec file with application/yaml', async () => {
      const res = makeRes();
      await controller.raw('organizations.yaml', res as never);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/yaml; charset=utf-8',
      );
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('openapi: 3.1.0'));
    });

    it('rejects non-yaml file requests', async () => {
      const res = makeRes();
      await expect(
        controller.raw('organizations.json', res as never),
      ).rejects.toThrow(HttpException);
    });

    it('rejects unknown spec names', async () => {
      const res = makeRes();
      await expect(controller.raw('made-up.yaml', res as never)).rejects.toThrow(
        HttpException,
      );
    });

    it('returns 404 with a clear message if the spec file is not on disk', async () => {
      // 'agents' is in the SPEC_FILES allowlist but we did not write it to
      // the temp dir, so the fs.readFile fails.
      const res = makeRes();
      await expect(controller.raw('agents.yaml', res as never)).rejects.toThrow(
        /not available/,
      );
    });
  });

  // Sanity: the 12 SPEC_FILES we advertise in the index should be the same 12
  // files actually present in packages/openapi/. This guards against drift
  // when a new spec is added — the test fails until SPEC_FILES is updated.
  it('advertises every spec that exists in packages/openapi', async () => {
    const html = controller.index();
    const repoSpecsDir = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'openapi');
    const files = await fs.readdir(repoSpecsDir);
    // Dotfiles (e.g. `.redocly.yaml` config) are not domain specs.
    const yamls = files
      .filter((f) => f.endsWith('.yaml') && !f.startsWith('.'))
      .map((f) => f.replace(/\.yaml$/, ''));

    for (const name of yamls) {
      expect(html).toContain(`/api/v1/docs/${name}`);
    }
  });
});

function makeRes(): { setHeader: jest.Mock; send: jest.Mock } {
  return {
    setHeader: jest.fn(),
    send: jest.fn(),
  };
}
