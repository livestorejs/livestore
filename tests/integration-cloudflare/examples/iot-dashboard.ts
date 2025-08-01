// @ts-nocheck

/**
 * IoT Device Dashboard Client-DO Example
 *
 * This example demonstrates how a client-do can manage IoT device data,
 * aggregate sensor readings, handle device commands, and provide real-time
 * monitoring capabilities for IoT deployments.
 */

import { makeClientDurableObject } from '@livestore/adapter-cloudflare'
import { Schema } from '@livestore/livestore'

// Schema for IoT dashboard state
const iotDashboardSchema = Schema.struct({
  devices: Schema.record(
    Schema.string, // deviceId
    Schema.struct({
      id: Schema.string,
      name: Schema.string,
      type: Schema.literal('sensor', 'actuator', 'gateway', 'camera', 'thermostat', 'light'),
      location: Schema.struct({
        building: Schema.string,
        floor: Schema.string,
        room: Schema.string,
        coordinates: Schema.optional(
          Schema.struct({
            lat: Schema.number,
            lng: Schema.number,
          }),
        ),
      }),
      status: Schema.literal('online', 'offline', 'maintenance', 'error'),
      lastSeen: Schema.string,
      firmware: Schema.string,
      batteryLevel: Schema.optional(Schema.number), // 0-100
      networkInfo: Schema.struct({
        signalStrength: Schema.number, // -100 to 0 dBm
        ipAddress: Schema.string,
        macAddress: Schema.string,
      }),
      configuration: Schema.record(Schema.string, Schema.unknown),
    }),
  ),
  sensorData: Schema.record(
    Schema.string, // deviceId
    Schema.struct({
      deviceId: Schema.string,
      readings: Schema.array(
        Schema.struct({
          timestamp: Schema.string,
          sensorType: Schema.literal('temperature', 'humidity', 'pressure', 'light', 'motion', 'air_quality', 'noise'),
          value: Schema.number,
          unit: Schema.string,
          quality: Schema.literal('good', 'fair', 'poor'),
        }),
      ),
      aggregates: Schema.struct({
        hourly: Schema.record(Schema.string, Schema.number), // hour -> average value
        daily: Schema.record(Schema.string, Schema.number), // date -> average value
        alerts: Schema.array(
          Schema.struct({
            id: Schema.string,
            type: Schema.literal('threshold', 'anomaly', 'offline'),
            severity: Schema.literal('low', 'medium', 'high', 'critical'),
            message: Schema.string,
            timestamp: Schema.string,
            acknowledged: Schema.boolean,
          }),
        ),
      }),
    }),
  ),
  dashboardState: Schema.struct({
    totalDevices: Schema.number,
    onlineDevices: Schema.number,
    offlineDevices: Schema.number,
    alertCount: Schema.number,
    dataPoints: Schema.number,
    lastUpdate: Schema.string,
    systemHealth: Schema.literal('healthy', 'warning', 'critical'),
  }),
  automationRules: Schema.array(
    Schema.struct({
      id: Schema.string,
      name: Schema.string,
      enabled: Schema.boolean,
      trigger: Schema.struct({
        deviceId: Schema.string,
        sensorType: Schema.string,
        condition: Schema.literal('above', 'below', 'equals', 'changed'),
        value: Schema.number,
      }),
      action: Schema.struct({
        type: Schema.literal('device_command', 'notification', 'webhook'),
        deviceId: Schema.optional(Schema.string),
        command: Schema.optional(Schema.string),
        parameters: Schema.optional(Schema.record(Schema.string, Schema.unknown)),
      }),
      lastTriggered: Schema.optional(Schema.string),
      triggerCount: Schema.number,
    }),
  ),
})

type IoTDashboardSchema = typeof iotDashboardSchema

// Create the IoT Dashboard Client-DO class
export class IoTDashboardClientDO extends makeClientDurableObject({
  schema: iotDashboardSchema,
  clientId: 'iot-dashboard',
  sessionId: 'dashboard-session',

  // Initialize dashboard state and register real-time queries
  registerQueries: async (store) => {
    const subscriptions = []

    // Monitor device status changes
    subscriptions.push(
      store.query.devices.subscribe((devices) => {
        updateDashboardStats(store, devices)
        checkDeviceHealth(store, devices)
      }),
    )

    // Process new sensor readings and trigger automation
    subscriptions.push(
      store.query.sensorData.subscribe((sensorData) => {
        Object.values(sensorData).forEach(async (deviceData: any) => {
          const latestReading = deviceData.readings[deviceData.readings.length - 1]
          if (latestReading) {
            await processNewReading(store, deviceData.deviceId, latestReading)
            await checkAutomationRules(store, deviceData.deviceId, latestReading)
          }
        })
      }),
    )

    // Aggregate sensor data periodically
    setInterval(() => {
      aggregateSensorData(store)
    }, 60000) // Every minute

    // Clean up old data
    setInterval(() => {
      cleanupOldData(store)
    }, 3600000) // Every hour

    // Check device connectivity
    setInterval(() => {
      checkDeviceConnectivity(store)
    }, 30000) // Every 30 seconds

    return subscriptions
  },

  // Handle IoT dashboard endpoints
  handleCustomRequest: async (request, ensureStore) => {
    const url = new URL(request.url)
    const store = await ensureStore.pipe(Effect.runPromise)

    switch (url.pathname) {
      case '/devices':
        if (request.method === 'GET') {
          return getDevices(store)
        } else if (request.method === 'POST') {
          return await registerDevice(store, request)
        }
        break

      case '/devices/command':
        if (request.method === 'POST') {
          return await sendDeviceCommand(store, request)
        }
        break

      case '/sensor-data':
        if (request.method === 'POST') {
          return await receiveSensorData(store, request)
        } else if (request.method === 'GET') {
          return getSensorData(store, url.searchParams)
        }
        break

      case '/dashboard':
        return getDashboardOverview(store)

      case '/alerts':
        if (request.method === 'GET') {
          return getAlerts(store)
        } else if (request.method === 'POST') {
          return await acknowledgeAlert(store, request)
        }
        break

      case '/automation':
        if (request.method === 'GET') {
          return getAutomationRules(store)
        } else if (request.method === 'POST') {
          return await createAutomationRule(store, request)
        }
        break

      case '/analytics':
        return getAnalytics(store, url.searchParams)

      case '/export':
        return await exportData(store, url.searchParams)
    }

    return null
  },
}) {}

// Device management
async function registerDevice(store: any, request: Request): Promise<Response> {
  const deviceData = await request.json()

  const device = {
    id: deviceData.id,
    name: deviceData.name,
    type: deviceData.type,
    location: deviceData.location,
    status: 'online' as const,
    lastSeen: new Date().toISOString(),
    firmware: deviceData.firmware || '1.0.0',
    batteryLevel: deviceData.batteryLevel,
    networkInfo: deviceData.networkInfo,
    configuration: deviceData.configuration || {},
  }

  await store.mutate.devices[device.id].set(device)

  // Initialize sensor data structure
  await store.mutate.sensorData[device.id].set({
    deviceId: device.id,
    readings: [],
    aggregates: {
      hourly: {},
      daily: {},
      alerts: [],
    },
  })

  await store.mutate.dashboardState.totalDevices.increment()
  await store.mutate.dashboardState.onlineDevices.increment()

  return Response.json({ success: true, device })
}

async function sendDeviceCommand(store: any, request: Request): Promise<Response> {
  const { deviceId, command, parameters } = await request.json()

  const device = store.query.devices[deviceId]?.get()
  if (!device) {
    return Response.json({ error: 'Device not found' }, { status: 404 })
  }

  if (device.status !== 'online') {
    return Response.json({ error: 'Device is offline' }, { status: 400 })
  }

  // Simulate sending command to device
  console.log(`Sending command "${command}" to device ${deviceId}`, parameters)

  // Update device last seen
  await store.mutate.devices[deviceId].lastSeen.set(new Date().toISOString())

  return Response.json({
    success: true,
    message: `Command "${command}" sent to device ${device.name}`,
  })
}

// Sensor data processing
async function receiveSensorData(store: any, request: Request): Promise<Response> {
  const { deviceId, readings } = await request.json()

  const device = store.query.devices[deviceId]?.get()
  if (!device) {
    return Response.json({ error: 'Device not found' }, { status: 404 })
  }

  // Update device status
  await store.mutate.devices[deviceId].status.set('online')
  await store.mutate.devices[deviceId].lastSeen.set(new Date().toISOString())

  // Process each reading
  for (const reading of readings) {
    const processedReading = {
      ...reading,
      timestamp: new Date().toISOString(),
      quality: determineDataQuality(reading),
    }

    await store.mutate.sensorData[deviceId].readings.push(processedReading)
  }

  // Keep only last 1000 readings per device
  const currentReadings = store.query.sensorData[deviceId].readings.get()
  if (currentReadings.length > 1000) {
    await store.mutate.sensorData[deviceId].readings.set(currentReadings.slice(-1000))
  }

  await store.mutate.dashboardState.dataPoints.add(readings.length)
  await store.mutate.dashboardState.lastUpdate.set(new Date().toISOString())

  return Response.json({ success: true, processedReadings: readings.length })
}

async function processNewReading(store: any, deviceId: string, reading: any) {
  // Check for threshold alerts
  const thresholds = getDeviceThresholds(reading.sensorType)

  if (reading.value > thresholds.high || reading.value < thresholds.low) {
    await createAlert(store, deviceId, 'threshold', {
      sensorType: reading.sensorType,
      value: reading.value,
      threshold: reading.value > thresholds.high ? thresholds.high : thresholds.low,
    })
  }

  // Detect anomalies (simple statistical approach)
  const recentReadings = store.query.sensorData[deviceId].readings
    .get()
    .filter((r: any) => r.sensorType === reading.sensorType)
    .slice(-10) // Last 10 readings

  if (recentReadings.length >= 5) {
    const average = recentReadings.reduce((sum: number, r: any) => sum + r.value, 0) / recentReadings.length
    const stdDev = Math.sqrt(
      recentReadings.reduce((sum: number, r: any) => sum + (r.value - average) ** 2, 0) / recentReadings.length,
    )

    if (Math.abs(reading.value - average) > 3 * stdDev) {
      await createAlert(store, deviceId, 'anomaly', {
        sensorType: reading.sensorType,
        value: reading.value,
        expected: average,
        deviation: Math.abs(reading.value - average),
      })
    }
  }
}

// Automation system
async function checkAutomationRules(store: any, deviceId: string, reading: any) {
  const rules = store.query.automationRules.get()

  for (const rule of rules) {
    if (!rule.enabled || rule.trigger.deviceId !== deviceId || rule.trigger.sensorType !== reading.sensorType) {
      continue
    }

    let triggered = false
    switch (rule.trigger.condition) {
      case 'above':
        triggered = reading.value > rule.trigger.value
        break
      case 'below':
        triggered = reading.value < rule.trigger.value
        break
      case 'equals':
        triggered = reading.value === rule.trigger.value
        break
      case 'changed': {
        // Check if value changed from previous reading
        const prevReading = store.query.sensorData[deviceId].readings
          .get()
          .filter((r: any) => r.sensorType === reading.sensorType)
          .slice(-2)[0]
        triggered = prevReading && prevReading.value !== reading.value
        break
      }
    }

    if (triggered) {
      await executeAutomationAction(store, rule)
      await store.mutate.automationRules[rules.indexOf(rule)].lastTriggered.set(new Date().toISOString())
      await store.mutate.automationRules[rules.indexOf(rule)].triggerCount.increment()
    }
  }
}

async function createAutomationRule(store: any, request: Request): Promise<Response> {
  const ruleData = await request.json()

  const rule = {
    id: crypto.randomUUID(),
    name: ruleData.name,
    enabled: true,
    trigger: ruleData.trigger,
    action: ruleData.action,
    triggerCount: 0,
  }

  await store.mutate.automationRules.push(rule)

  return Response.json({ success: true, rule })
}

async function executeAutomationAction(_store: any, rule: any) {
  switch (rule.action.type) {
    case 'device_command':
      if (rule.action.deviceId && rule.action.command) {
        // Send command to target device
        console.log(`Automation: Sending ${rule.action.command} to ${rule.action.deviceId}`)
      }
      break
    case 'notification':
      console.log(`Automation Alert: ${rule.name} triggered`)
      break
    case 'webhook':
      // Send HTTP request to webhook URL
      console.log(`Automation: Webhook triggered for rule ${rule.name}`)
      break
  }
}

// Analytics and aggregation
async function aggregateSensorData(store: any) {
  const now = new Date()
  const hourKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`
  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`

  const sensorData = store.query.sensorData.get()

  for (const [deviceId, data] of Object.entries(sensorData)) {
    const recentReadings = (data as any).readings.filter(
      (r: any) => new Date(r.timestamp) > new Date(now.getTime() - 3600000),
    ) // Last hour

    if (recentReadings.length === 0) continue

    // Group by sensor type and calculate averages
    const sensorTypes = [...new Set(recentReadings.map((r: any) => r.sensorType))]

    for (const sensorType of sensorTypes) {
      const typeReadings = recentReadings.filter((r: any) => r.sensorType === sensorType)
      const average = typeReadings.reduce((sum: number, r: any) => sum + r.value, 0) / typeReadings.length

      const hourlyKey = `${sensorType}_${hourKey}`
      const dailyKey = `${sensorType}_${dayKey}`

      await store.mutate.sensorData[deviceId].aggregates.hourly[hourlyKey].set(average)

      // Update daily average (running average)
      const existingDaily = (data as any).aggregates.daily[dailyKey] || 0
      const newDaily = existingDaily === 0 ? average : (existingDaily + average) / 2
      await store.mutate.sensorData[deviceId].aggregates.daily[dailyKey].set(newDaily)
    }
  }
}

// Utility functions
async function updateDashboardStats(store: any, devices: Record<string, any>) {
  const deviceList = Object.values(devices)
  const onlineDevices = deviceList.filter((d: any) => d.status === 'online').length
  const offlineDevices = deviceList.filter((d: any) => d.status === 'offline').length

  await store.mutate.dashboardState.totalDevices.set(deviceList.length)
  await store.mutate.dashboardState.onlineDevices.set(onlineDevices)
  await store.mutate.dashboardState.offlineDevices.set(offlineDevices)

  // Determine system health
  const healthRatio = onlineDevices / deviceList.length
  let systemHealth: 'healthy' | 'warning' | 'critical'
  if (healthRatio > 0.9) systemHealth = 'healthy'
  else if (healthRatio > 0.7) systemHealth = 'warning'
  else systemHealth = 'critical'

  await store.mutate.dashboardState.systemHealth.set(systemHealth)
}

async function checkDeviceHealth(store: any, devices: Record<string, any>) {
  for (const [deviceId, device] of Object.entries(devices)) {
    const deviceData = device as any
    const timeSinceLastSeen = Date.now() - new Date(deviceData.lastSeen).getTime()

    // Mark device as offline if not seen for 5 minutes
    if (timeSinceLastSeen > 300000 && deviceData.status === 'online') {
      await store.mutate.devices[deviceId].status.set('offline')
      await createAlert(store, deviceId, 'offline', {
        lastSeen: deviceData.lastSeen,
        duration: timeSinceLastSeen,
      })
    }

    // Battery level alerts
    if (deviceData.batteryLevel && deviceData.batteryLevel < 20) {
      await createAlert(store, deviceId, 'threshold', {
        type: 'battery',
        level: deviceData.batteryLevel,
      })
    }
  }
}

async function createAlert(store: any, deviceId: string, type: string, data: any) {
  const alert = {
    id: crypto.randomUUID(),
    type,
    severity: determineSeverity(type, data),
    message: generateAlertMessage(deviceId, type, data),
    timestamp: new Date().toISOString(),
    acknowledged: false,
  }

  await store.mutate.sensorData[deviceId].aggregates.alerts.push(alert)
  await store.mutate.dashboardState.alertCount.increment()
}

function determineDataQuality(reading: any): 'good' | 'fair' | 'poor' {
  // Simple quality determination based on value ranges
  if (reading.sensorType === 'temperature') {
    return reading.value >= -40 && reading.value <= 80 ? 'good' : 'poor'
  }
  if (reading.sensorType === 'humidity') {
    return reading.value >= 0 && reading.value <= 100 ? 'good' : 'poor'
  }
  return 'good'
}

function getDeviceThresholds(sensorType: string) {
  const thresholds: Record<string, { low: number; high: number }> = {
    temperature: { low: 10, high: 35 },
    humidity: { low: 30, high: 70 },
    pressure: { low: 900, high: 1100 },
    light: { low: 100, high: 10000 },
    air_quality: { low: 0, high: 300 },
    noise: { low: 30, high: 85 },
  }
  return thresholds[sensorType] || { low: 0, high: 1000 }
}

function determineSeverity(type: string, data: any): 'low' | 'medium' | 'high' | 'critical' {
  switch (type) {
    case 'offline':
      return data.duration > 3600000 ? 'critical' : 'high' // > 1 hour
    case 'threshold':
      return data.type === 'battery' && data.level < 10 ? 'critical' : 'medium'
    case 'anomaly':
      return data.deviation > 50 ? 'high' : 'medium'
    default:
      return 'low'
  }
}

function generateAlertMessage(deviceId: string, type: string, data: any): string {
  switch (type) {
    case 'offline':
      return `Device ${deviceId} has been offline for ${Math.floor(data.duration / 60000)} minutes`
    case 'threshold':
      if (data.type === 'battery') {
        return `Device ${deviceId} battery level is low: ${data.level}%`
      }
      return `Device ${deviceId} ${data.sensorType} reading (${data.value}) exceeded threshold (${data.threshold})`
    case 'anomaly':
      return `Device ${deviceId} ${data.sensorType} reading (${data.value}) is anomalous (expected ~${data.expected.toFixed(2)})`
    default:
      return `Alert for device ${deviceId}`
  }
}

// API response functions
function getDevices(store: any): Response {
  const devices = store.query.devices.get()
  const dashboardState = store.query.dashboardState.get()

  return Response.json({
    devices,
    summary: {
      total: dashboardState.totalDevices,
      online: dashboardState.onlineDevices,
      offline: dashboardState.offlineDevices,
      systemHealth: dashboardState.systemHealth,
    },
  })
}

function getDashboardOverview(store: any): Response {
  const dashboardState = store.query.dashboardState.get()
  const devices = store.query.devices.get()
  const sensorData = store.query.sensorData.get()

  // Calculate recent data points
  const recentAlerts = Object.values(sensorData)
    .flatMap((data: any) => data.aggregates.alerts)
    .filter((alert: any) => !alert.acknowledged).length

  return Response.json({
    overview: dashboardState,
    recentAlerts,
    deviceTypes: Object.values(devices).reduce((acc: any, device: any) => {
      acc[device.type] = (acc[device.type] || 0) + 1
      return acc
    }, {}),
    lastUpdate: dashboardState.lastUpdate,
  })
}

function getSensorData(store: any, params: URLSearchParams): Response {
  const deviceId = params.get('deviceId')
  const sensorType = params.get('sensorType')
  const hours = Number.parseInt(params.get('hours') || '24')

  if (!deviceId) {
    return Response.json({ error: 'deviceId required' }, { status: 400 })
  }

  const deviceData = store.query.sensorData[deviceId]?.get()
  if (!deviceData) {
    return Response.json({ error: 'Device not found' }, { status: 404 })
  }

  const cutoff = new Date(Date.now() - hours * 3600000)
  let readings = deviceData.readings.filter((r: any) => new Date(r.timestamp) > cutoff)

  if (sensorType) {
    readings = readings.filter((r: any) => r.sensorType === sensorType)
  }

  return Response.json({
    deviceId,
    readings,
    aggregates: deviceData.aggregates,
    summary: {
      totalReadings: readings.length,
      timeRange: `${hours} hours`,
      sensorTypes: [...new Set(readings.map((r: any) => r.sensorType))],
    },
  })
}

function getAlerts(store: any): Response {
  const sensorData = store.query.sensorData.get()
  const allAlerts = Object.values(sensorData)
    .flatMap((data: any) => data.aggregates.alerts)
    .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return Response.json({
    alerts: allAlerts.slice(0, 50), // Last 50 alerts
    summary: {
      total: allAlerts.length,
      unacknowledged: allAlerts.filter((a: any) => !a.acknowledged).length,
      critical: allAlerts.filter((a: any) => a.severity === 'critical').length,
    },
  })
}

function getAutomationRules(store: any): Response {
  const rules = store.query.automationRules.get()

  return Response.json({
    rules,
    summary: {
      total: rules.length,
      enabled: rules.filter((r: any) => r.enabled).length,
      totalTriggers: rules.reduce((sum: number, r: any) => sum + r.triggerCount, 0),
    },
  })
}

function getAnalytics(store: any, params: URLSearchParams): Response {
  const period = params.get('period') || 'day' // day, week, month
  const sensorData = store.query.sensorData.get()

  // Generate analytics based on aggregated data
  const analytics = {
    period,
    deviceCount: Object.keys(sensorData).length,
    dataPoints: Object.values(sensorData).reduce((sum: number, data: any) => sum + data.readings.length, 0),
    averageReadingsPerDevice: 0,
    sensorTypeDistribution: {},
    alertTrends: {},
  }

  analytics.averageReadingsPerDevice = analytics.dataPoints / analytics.deviceCount

  return Response.json({ analytics })
}

// Additional placeholder functions
async function checkDeviceConnectivity(_store: any) {
  // Check device connectivity and update status
}

async function cleanupOldData(_store: any) {
  // Remove old readings and aggregates to manage storage
}

async function acknowledgeAlert(_store: any, _request: Request): Promise<Response> {
  return Response.json({ success: true })
}

async function exportData(_store: any, _params: URLSearchParams): Promise<Response> {
  return Response.json({ success: true })
}

/**
 * Usage Example:
 *
 * 1. Register a new IoT device:
 *    POST /devices
 *    {
 *      "id": "sensor-001",
 *      "name": "Office Temperature Sensor",
 *      "type": "sensor",
 *      "location": { "building": "HQ", "floor": "2", "room": "Conference A" }
 *    }
 *
 * 2. Send sensor data:
 *    POST /sensor-data
 *    {
 *      "deviceId": "sensor-001",
 *      "readings": [
 *        { "sensorType": "temperature", "value": 22.5, "unit": "°C" },
 *        { "sensorType": "humidity", "value": 45, "unit": "%" }
 *      ]
 *    }
 *
 * 3. Create automation rule:
 *    POST /automation
 *    {
 *      "name": "High Temperature Alert",
 *      "trigger": { "deviceId": "sensor-001", "sensorType": "temperature", "condition": "above", "value": 30 },
 *      "action": { "type": "notification" }
 *    }
 *
 * 4. Get dashboard overview:
 *    GET /dashboard
 *
 * 5. Send device command:
 *    POST /devices/command
 *    { "deviceId": "thermostat-001", "command": "set_temperature", "parameters": { "temperature": 24 } }
 *
 * The client-do provides comprehensive IoT device management with real-time monitoring,
 * automated alerts, rule-based automation, and persistent device state.
 */
