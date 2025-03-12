import fs from 'node:fs'
import path from 'node:path'

// Load test results
const resultsPath = path.join(import.meta.dirname, '../../test-results/results.json')
const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'))

// Process results into performance metrics
const processResults = (results) => {
  const metrics = {
    queryLatency: {},
    mutationLatency: {},
    startupTime: {},
    memoryConsumption: {},
    throughput: {}
  }

  // Process each test result
  results.suites.forEach(suite => {
    processSuite(suite, metrics)
  })

  return metrics
}

// Process a test suite recursively
const processSuite = (suite, metrics) => {
  if (suite.suites && suite.suites.length > 0) {
    suite.suites.forEach(s => processSuite(s, metrics))
  }

  if (suite.specs && suite.specs.length > 0) {
    suite.specs.forEach(spec => {
      const testName = spec.title

      if (testName.includes('Query performance')) {
        const dbSize = extractDatabaseSize(testName)
        if (!metrics.queryLatency[dbSize]) {
          metrics.queryLatency[dbSize] = {}
        }

        spec.tests.forEach(test => {
          if (test.results && test.results.length > 0) {
            const result = test.results[0]
            if (result.attachments) {
              result.attachments.forEach(attachment => {
                if (attachment.name === 'result') {
                  const data = JSON.parse(atob(attachment.body))
                  metrics.queryLatency[dbSize].simple = data.simpleQueryTime
                  metrics.queryLatency[dbSize].filtered = data.filteredQueryTime
                }
              })
            }
          }
        })
      }

      // Process other test types similarly...
    })
  }
}

// Extract database size from test name
const extractDatabaseSize = (testName) => {
  const match = testName.match(/with (\d+) records/)
  return match ? match[1] : 'unknown'
}

// Generate HTML report
const generateHtmlReport = (metrics) => {
  // Create HTML with charts using metrics data
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>LiveStore Performance Report</title>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .chart-container { width: 800px; height: 400px; margin-bottom: 30px; }
      </style>
    </head>
    <body>
      <h1>LiveStore Performance Report</h1>
      
      <h2>Query Latency</h2>
      <div class="chart-container">
        <canvas id="queryLatencyChart"></canvas>
      </div>
      
      <h2>Mutation Latency</h2>
      <div class="chart-container">
        <canvas id="mutationLatencyChart"></canvas>
      </div>
      
      <h2>Startup Time</h2>
      <div class="chart-container">
        <canvas id="startupTimeChart"></canvas>
      </div>
      
      <script>
        // Chart data
        const metrics = ${JSON.stringify(metrics)};
        
        // Create charts
        window.onload = function() {
          // Query latency chart
          const queryCtx = document.getElementById('queryLatencyChart').getContext('2d');
          new Chart(queryCtx, {
            type: 'bar',
            data: {
              labels: Object.keys(metrics.queryLatency),
              datasets: [
                {
                  label: 'Simple Query (ms)',
                  data: Object.values(metrics.queryLatency).map(v => v.simple),
                  backgroundColor: 'rgba(54, 162, 235, 0.5)'
                },
                {
                  label: 'Filtered Query (ms)',
                  data: Object.values(metrics.queryLatency).map(v => v.filtered),
                  backgroundColor: 'rgba(255, 99, 132, 0.5)'
                }
              ]
            },
            options: {
              scales: {
                y: {
                  beginAtZero: true,
                  title: {
                    display: true,
                    text: 'Time (ms)'
                  }
                },
                x: {
                  title: {
                    display: true,
                    text: 'Database Size (records)'
                  }
                }
              }
            }
          });
        };
      </script>
    </body>
    </html>
  `

  fs.writeFileSync(path.join(import.meta.dirname, '../../test-results/report.html'), html)
  console.log('Performance report generated at test-results/report.html')
}

// Main execution
const metrics = processResults(results)
generateHtmlReport(metrics)
