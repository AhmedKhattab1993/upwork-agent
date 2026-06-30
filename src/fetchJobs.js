import { graphql } from './client.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Fetch Upwork's native latest Web, Mobile & Software Dev jobs.
 *
 * This intentionally avoids keyword search. The universe is Upwork's own
 * category taxonomy, and ordering is Upwork's native RECENCY sort.
 *
 * Usage:
 *   node src/fetchJobs.js [limit] [outputPath]
 *   node src/fetchJobs.js 1000 data/latest-software-dev-jobs.jsonl
 */
const SOFTWARE_DEV_CATEGORY_ID = '531770282580668418';
const SOFTWARE_DEV_CATEGORY_NAME = 'Web, Mobile & Software Dev';
const PAGE_SIZE = 50;

const JOB_QUERY = /* GraphQL */ `
  query LatestSoftwareJobs(
    $filter: MarketplaceJobPostingsSearchFilter,
    $sort: [MarketplaceJobPostingSearchSortAttribute]
  ) {
    marketplaceJobPostingsSearch(
      marketPlaceJobFilter: $filter,
      searchType: USER_JOBS_SEARCH,
      sortAttributes: $sort
    ) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          ciphertext
          title
          description
          publishedDateTime
          createdDateTime
          renewedDateTime
          category
          subcategory
          duration
          durationLabel
          engagement
          experienceLevel
          totalApplicants
          skills {
            name
            prettyName
            highlighted
          }
          client {
            totalHires
            totalPostedJobs
            totalSpent {
              rawValue
              currency
              displayValue
            }
            verificationStatus
            location {
              country
              city
              state
              timezone
            }
            totalReviews
            totalFeedback
          }
          amount {
            rawValue
            currency
            displayValue
          }
          hourlyBudgetMin {
            rawValue
            currency
            displayValue
          }
          hourlyBudgetMax {
            rawValue
            currency
            displayValue
          }
          occupations {
            category {
              id
              prefLabel
            }
            subCategories {
              id
              prefLabel
            }
            occupationService {
              id
              prefLabel
            }
          }
        }
      }
    }
  }
`;

function defaultOutputPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return resolve(`data/upwork-latest-software-dev-jobs-${stamp}.jsonl`);
}

function parseLimit(value) {
  const limit = Number(value ?? 1000);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`limit must be a positive integer, got ${value}`);
  }
  return limit;
}

function summarize(jobs, totalCount, outputPath) {
  const ids = new Set(jobs.map((job) => job.id));
  const outOfPublishedOrder = jobs.findIndex((job, index) => (
    index > 0
    && new Date(job.publishedDateTime) > new Date(jobs[index - 1].publishedDateTime)
  ));

  return {
    generatedAt: new Date().toISOString(),
    source: 'upwork.graphql.marketplaceJobPostingsSearch',
    categoryId: SOFTWARE_DEV_CATEGORY_ID,
    categoryName: SOFTWARE_DEV_CATEGORY_NAME,
    sort: 'RECENCY',
    requested: jobs.length,
    fetched: jobs.length,
    unique: ids.size,
    duplicates: jobs.length - ids.size,
    totalCount,
    newestPublishedDateTime: jobs[0]?.publishedDateTime ?? null,
    oldestPublishedDateTime: jobs.at(-1)?.publishedDateTime ?? null,
    outOfPublishedOrderIndex: outOfPublishedOrder,
    outputPath,
  };
}

async function main() {
  const limit = parseLimit(process.argv[2]);
  const outputPath = resolve(process.argv[3] ?? defaultOutputPath());
  const summaryPath = outputPath.toLowerCase().endsWith('.jsonl')
    ? outputPath.replace(/\.jsonl$/i, '.summary.json')
    : `${outputPath}.summary.json`;

  try {
    const jobs = [];
    let after = '0';
    let totalCount = null;

    console.log(`Fetching ${limit} native-recency jobs from ${SOFTWARE_DEV_CATEGORY_NAME}...`);

    while (jobs.length < limit) {
      const remaining = limit - jobs.length;
      const first = Math.min(PAGE_SIZE, remaining);
      const filter = {
        categoryIds_any: [SOFTWARE_DEV_CATEGORY_ID],
        pagination_eq: { after, first },
      };
      const variables = {
        filter,
        sort: [{ field: 'RECENCY' }],
      };
      const data = await graphql(JOB_QUERY, variables);
      const result = data?.marketplaceJobPostingsSearch;
      if (!result) {
        throw new Error('missing marketplaceJobPostingsSearch result');
      }

      totalCount ??= result.totalCount;
      const batch = result.edges?.map((edge) => edge.node) ?? [];
      jobs.push(...batch);

      console.log(
        `  page ${Math.ceil(jobs.length / PAGE_SIZE)}: ${batch.length} jobs, total ${jobs.length}, next ${result.pageInfo?.endCursor ?? 'none'}`
      );

      if (!result.pageInfo?.hasNextPage || batch.length === 0) {
        break;
      }
      after = result.pageInfo.endCursor;
    }

    const trimmed = jobs.slice(0, limit);
    const summary = summarize(trimmed, totalCount, outputPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${trimmed.map((job) => JSON.stringify(job)).join('\n')}\n`);
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

    console.log(`Wrote ${trimmed.length} jobs to ${outputPath}`);
    console.log(`Wrote summary to ${summaryPath}`);
    console.log(JSON.stringify(summary, null, 2));
  } catch (e) {
    console.error('Failed:', e.message);
    process.exit(1);
  }
}

main();
