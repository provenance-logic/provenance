import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from '../app.module.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { ProductIndexService } from '../search/product-index.service.js';
import { SearchIndexingService } from '../search/search-indexing.service.js';

// One-shot reindex command. Walks `products.data_products` for every
// published or deprecated product across every org and re-writes both
// OpenSearch indices: kNN (`data_products`, semantic search) and BM25
// (`provenance-products`, marketplace keyword search).
//
// Usage (from inside the api container, after `nest build` has run):
//
//   pnpm --filter @provenance/api reindex:search
//
// Idempotent — uses the same `client.index({ id, refresh: true })` upsert
// the live publish path uses, so re-running doesn't create duplicates.
// Safe to run after every dev-stack rebuild or seed-data refresh; needed
// once after this commit lands to backfill the BM25 index, which has
// historically been populated only via the Redpanda consumer and stays
// empty whenever the broker queue is reset (B-009).
async function reindex(): Promise<void> {
  const logger = new Logger('reindex-search');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const productRepo = app.get<Repository<DataProductEntity>>(
      getRepositoryToken(DataProductEntity),
    );
    const productIndex = app.get(ProductIndexService);
    const searchIndex  = app.get(SearchIndexingService);

    // Index published and deprecated products. Decommissioned products
    // are intentionally excluded — they should not appear in either index.
    const products = await productRepo.find({
      where: { status: In(['published', 'deprecated']) },
    });

    if (products.length === 0) {
      logger.warn('No published or deprecated products found — nothing to reindex.');
      return;
    }
    logger.log(`Reindexing ${products.length} products into both OpenSearch indices...`);

    let bm25Ok = 0;
    let bm25Fail = 0;
    let knnOk = 0;
    let knnFail = 0;

    for (const product of products) {
      try {
        await productIndex.indexProductById(product.id, product.orgId);
        bm25Ok++;
      } catch (err) {
        bm25Fail++;
        logger.warn(
          `BM25 indexing failed for ${product.id} (${product.name}): ${(err as Error).message}`,
        );
      }
      try {
        await searchIndex.indexProduct(product.id, product.orgId);
        knnOk++;
      } catch (err) {
        knnFail++;
        logger.warn(
          `kNN indexing failed for ${product.id} (${product.name}): ${(err as Error).message}`,
        );
      }
    }

    logger.log(
      `Done. BM25: ${bm25Ok}/${products.length} succeeded (${bm25Fail} failed). ` +
      `kNN: ${knnOk}/${products.length} succeeded (${knnFail} failed).`,
    );

    if (bm25Fail + knnFail > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

reindex()
  .then(() => {
    // Force exit even if some module's onModuleDestroy hasn't fully drained
    // (the Kafka consumer poll loop in particular keeps the event loop alive
    // for a few seconds after disconnect). The reindex work is complete by
    // the time we reach here; we do not want to wait on background daemons.
    process.exit(process.exitCode ?? 0);
  })
  .catch((err: unknown) => {
    console.error('Reindex script failed:', err);
    process.exit(1);
  });
