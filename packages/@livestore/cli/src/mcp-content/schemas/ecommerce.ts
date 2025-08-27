export const ecommerceSchemaContent = `import { Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

// E-commerce with inventory management and order processing
export const tables = {
  products: State.SQLite.table({
    name: 'products',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      sku: State.SQLite.text(),
      name: State.SQLite.text(),
      description: State.SQLite.text(),
      price: State.SQLite.integer(), // Store as cents to avoid floating point issues
      currency: State.SQLite.text({ default: 'USD' }),
      stock: State.SQLite.integer({ default: 0 }),
      reservedStock: State.SQLite.integer({ default: 0 }), // For pending orders
      isActive: State.SQLite.boolean({ default: true }),
      weight: State.SQLite.real({ nullable: true }), // For shipping calculations
      dimensions: State.SQLite.text({ nullable: true }), // JSON: {width, height, depth}
      imageUrls: State.SQLite.text({ nullable: true }), // JSON array
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      updatedAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    },
  }),
  
  categories: State.SQLite.table({
    name: 'categories',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      name: State.SQLite.text(),
      slug: State.SQLite.text(),
      parentId: State.SQLite.text({ nullable: true }), // For hierarchical categories
      description: State.SQLite.text({ nullable: true }),
      imageUrl: State.SQLite.text({ nullable: true }),
      sortOrder: State.SQLite.integer({ default: 0 }),
      isActive: State.SQLite.boolean({ default: true }),
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),
  
  productCategories: State.SQLite.table({
    name: 'product_categories',
    columns: {
      productId: State.SQLite.text(),
      categoryId: State.SQLite.text(),
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),
  
  customers: State.SQLite.table({
    name: 'customers',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      email: State.SQLite.text(),
      firstName: State.SQLite.text({ nullable: true }),
      lastName: State.SQLite.text({ nullable: true }),
      phone: State.SQLite.text({ nullable: true }),
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      lastOrderAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    },
  }),
  
  addresses: State.SQLite.table({
    name: 'addresses',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      customerId: State.SQLite.text(),
      type: State.SQLite.text({ default: 'shipping' }), // shipping, billing
      firstName: State.SQLite.text(),
      lastName: State.SQLite.text(),
      company: State.SQLite.text({ nullable: true }),
      address1: State.SQLite.text(),
      address2: State.SQLite.text({ nullable: true }),
      city: State.SQLite.text(),
      state: State.SQLite.text(),
      country: State.SQLite.text(),
      postalCode: State.SQLite.text(),
      isDefault: State.SQLite.boolean({ default: false }),
    },
  }),
  
  orders: State.SQLite.table({
    name: 'orders',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      orderNumber: State.SQLite.text(), // Human-readable order number
      customerId: State.SQLite.text(),
      status: State.SQLite.text({ default: 'draft' }), // draft, pending, paid, processing, shipped, delivered, cancelled
      paymentStatus: State.SQLite.text({ default: 'pending' }), // pending, paid, failed, refunded
      fulfillmentStatus: State.SQLite.text({ default: 'unfulfilled' }), // unfulfilled, partial, fulfilled
      
      subtotal: State.SQLite.integer(), // In cents
      taxAmount: State.SQLite.integer({ default: 0 }),
      shippingAmount: State.SQLite.integer({ default: 0 }),
      discountAmount: State.SQLite.integer({ default: 0 }),
      total: State.SQLite.integer(),
      currency: State.SQLite.text({ default: 'USD' }),
      
      shippingAddress: State.SQLite.text(), // JSON
      billingAddress: State.SQLite.text(), // JSON
      
      notes: State.SQLite.text({ nullable: true }),
      
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      updatedAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      cancelledAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
      shippedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
      deliveredAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    },
  }),
  
  orderItems: State.SQLite.table({
    name: 'order_items',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      orderId: State.SQLite.text(),
      productId: State.SQLite.text(),
      variantId: State.SQLite.text({ nullable: true }),
      sku: State.SQLite.text(), // Snapshot at time of order
      name: State.SQLite.text(), // Product name at time of order
      quantity: State.SQLite.integer(),
      unitPrice: State.SQLite.integer(), // Price per unit in cents
      totalPrice: State.SQLite.integer(), // quantity * unitPrice
      fulfillmentStatus: State.SQLite.text({ default: 'unfulfilled' }),
    },
  }),
  
  // Inventory tracking with event sourcing
  inventoryEvents: State.SQLite.table({
    name: 'inventory_events',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      productId: State.SQLite.text(),
      type: State.SQLite.text(), // 'adjustment', 'sale', 'return', 'damage', 'restock'
      quantity: State.SQLite.integer(), // Can be positive or negative
      reason: State.SQLite.text({ nullable: true }),
      referenceId: State.SQLite.text({ nullable: true }), // Order ID, adjustment ID, etc.
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),
  
  // Shopping cart (client-side state)
  cart: State.SQLite.clientDocument({
    name: 'cart',
    schema: Schema.Struct({
      items: Schema.Array(Schema.Struct({
        productId: Schema.String,
        quantity: Schema.Number,
        addedAt: Schema.Date,
      })),
      discountCode: Schema.NullOr(Schema.String),
      notes: Schema.String,
    }),
    default: { 
      id: SessionIdSymbol, 
      value: { items: [], discountCode: null, notes: '' }
    },
  }),
}

export const events = {
  // Product management
  productCreated: Events.synced({
    name: 'v1.ProductCreated',
    schema: Schema.Struct({
      id: Schema.String,
      sku: Schema.String,
      name: Schema.String,
      description: Schema.String,
      price: Schema.Number, // In cents
      currency: Schema.String,
      createdAt: Schema.Date,
    }),
  }),
  
  productUpdated: Events.synced({
    name: 'v1.ProductUpdated',
    schema: Schema.Struct({
      id: Schema.String,
      name: Schema.NullOr(Schema.String),
      description: Schema.NullOr(Schema.String),
      price: Schema.NullOr(Schema.Number),
      updatedAt: Schema.Date,
    }),
  }),
  
  productStockAdjusted: Events.synced({
    name: 'v1.ProductStockAdjusted',
    schema: Schema.Struct({
      productId: Schema.String,
      adjustment: Schema.Number, // Can be positive or negative
      reason: Schema.String,
      referenceId: Schema.NullOr(Schema.String),
      createdAt: Schema.Date,
    }),
  }),
  
  productDeactivated: Events.synced({
    name: 'v1.ProductDeactivated',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  
  // Customer management
  customerCreated: Events.synced({
    name: 'v1.CustomerCreated',
    schema: Schema.Struct({
      id: Schema.String,
      email: Schema.String,
      firstName: Schema.NullOr(Schema.String),
      lastName: Schema.NullOr(Schema.String),
      createdAt: Schema.Date,
    }),
  }),
  
  // Order lifecycle with state machine
  orderCreated: Events.synced({
    name: 'v1.OrderCreated',
    schema: Schema.Struct({
      id: Schema.String,
      orderNumber: Schema.String,
      customerId: Schema.String,
      items: Schema.Array(Schema.Struct({
        productId: Schema.String,
        sku: Schema.String,
        name: Schema.String,
        quantity: Schema.Number,
        unitPrice: Schema.Number,
      })),
      subtotal: Schema.Number,
      total: Schema.Number,
      shippingAddress: Schema.Object,
      billingAddress: Schema.Object,
      createdAt: Schema.Date,
    }),
  }),
  
  orderPaymentReceived: Events.synced({
    name: 'v1.OrderPaymentReceived',
    schema: Schema.Struct({
      orderId: Schema.String,
      amount: Schema.Number,
      paymentMethod: Schema.String,
      transactionId: Schema.String,
      paidAt: Schema.Date,
    }),
  }),
  
  orderShipped: Events.synced({
    name: 'v1.OrderShipped',
    schema: Schema.Struct({
      orderId: Schema.String,
      trackingNumber: Schema.NullOr(Schema.String),
      carrier: Schema.NullOr(Schema.String),
      shippedAt: Schema.Date,
    }),
  }),
  
  orderDelivered: Events.synced({
    name: 'v1.OrderDelivered',
    schema: Schema.Struct({
      orderId: Schema.String,
      deliveredAt: Schema.Date,
    }),
  }),
  
  orderCancelled: Events.synced({
    name: 'v1.OrderCancelled',
    schema: Schema.Struct({
      orderId: Schema.String,
      reason: Schema.String,
      cancelledAt: Schema.Date,
    }),
  }),
  
  // Cart management (local)
  cartUpdated: tables.cart.set,
}

// Materializers with business logic and constraints
const materializers = State.SQLite.materializers(events, {
  // Product materializers
  'v1.ProductCreated': ({ id, sku, name, description, price, currency, createdAt }) =>
    tables.products.insert({ id, sku, name, description, price, currency, createdAt, updatedAt: createdAt }),
    
  'v1.ProductUpdated': ({ id, name, description, price, updatedAt }) =>
    tables.products.update({ 
      name: name ?? undefined,
      description: description ?? undefined, 
      price: price ?? undefined,
      updatedAt 
    }).where({ id }),
    
  'v1.ProductStockAdjusted': ({ productId, adjustment, reason, referenceId, createdAt }) => [
    // Record the inventory event
    tables.inventoryEvents.insert({ 
      id: crypto.randomUUID(),
      productId, 
      type: 'adjustment',
      quantity: adjustment, 
      reason, 
      referenceId, 
      createdAt 
    }),
    // Update product stock (eventually consistent)
    tables.products.update({ 
      stock: Math.max(0, tables.products.select('stock').where({ id: productId }).scalar() + adjustment),
      updatedAt: createdAt
    }).where({ id: productId }),
  ],
    
  'v1.ProductDeactivated': ({ id }) =>
    tables.products.update({ isActive: false }).where({ id }),
    
  // Customer materializers
  'v1.CustomerCreated': ({ id, email, firstName, lastName, createdAt }) =>
    tables.customers.insert({ id, email, firstName, lastName, createdAt }),
    
  // Order materializers with inventory reservation
  'v1.OrderCreated': ({ id, orderNumber, customerId, items, subtotal, total, shippingAddress, billingAddress, createdAt }) => [
    // Create the order
    tables.orders.insert({ 
      id, 
      orderNumber, 
      customerId, 
      status: 'pending',
      subtotal, 
      total, 
      shippingAddress: JSON.stringify(shippingAddress),
      billingAddress: JSON.stringify(billingAddress),
      createdAt, 
      updatedAt: createdAt 
    }),
    // Create order items and reserve inventory
    ...items.flatMap(item => [
      tables.orderItems.insert({ 
        id: crypto.randomUUID(),
        orderId: id,
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.quantity * item.unitPrice,
      }),
      // Reserve stock
      tables.products.update({ 
        reservedStock: tables.products.select('reservedStock').where({ id: item.productId }).scalar() + item.quantity
      }).where({ id: item.productId }),
    ]),
  ],
    
  'v1.OrderPaymentReceived': ({ orderId, amount, paymentMethod, transactionId, paidAt }) =>
    tables.orders.update({ 
      status: 'paid', 
      paymentStatus: 'paid',
      updatedAt: paidAt 
    }).where({ id: orderId }),
    
  'v1.OrderShipped': ({ orderId, trackingNumber, carrier, shippedAt }) => [
    tables.orders.update({ 
      status: 'shipped',
      fulfillmentStatus: 'fulfilled',
      shippedAt,
      updatedAt: shippedAt 
    }).where({ id: orderId }),
    // Convert reserved stock to actual stock reduction
    ...tables.orderItems.select().where({ orderId }).map(item => 
      tables.products.update({ 
        stock: tables.products.select('stock').where({ id: item.productId }).scalar() - item.quantity,
        reservedStock: tables.products.select('reservedStock').where({ id: item.productId }).scalar() - item.quantity
      }).where({ id: item.productId })
    ),
  ],
    
  'v1.OrderDelivered': ({ orderId, deliveredAt }) =>
    tables.orders.update({ 
      status: 'delivered',
      deliveredAt,
      updatedAt: deliveredAt 
    }).where({ id: orderId }),
    
  'v1.OrderCancelled': ({ orderId, reason, cancelledAt }) => [
    tables.orders.update({ 
      status: 'cancelled',
      cancelledAt,
      notes: reason,
      updatedAt: cancelledAt 
    }).where({ id: orderId }),
    // Release reserved inventory
    ...tables.orderItems.select().where({ orderId }).map(item => 
      tables.products.update({ 
        reservedStock: Math.max(0, tables.products.select('reservedStock').where({ id: item.productId }).scalar() - item.quantity)
      }).where({ id: item.productId })
    ),
  ],
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })

// Example queries for business intelligence:
//
// // Available products with real-time stock
// const availableProducts$ = queryDb(
//   tables.products
//     .select()
//     .where({ isActive: true, deletedAt: null })
//     .having(tables.products.column('stock').minus(tables.products.column('reservedStock')).gt(0))
//     .orderBy('name'),
//   { label: 'availableProducts' }
// )
//
// // Orders requiring fulfillment
// const pendingOrders$ = queryDb(
//   tables.orders
//     .select()
//     .join(tables.customers, 'customerId', 'id')
//     .where({ 
//       'orders.status': 'paid',
//       'orders.fulfillmentStatus': 'unfulfilled'
//     })
//     .orderBy('orders.createdAt'),
//   { label: 'pendingOrders' }
// )
//
// // Low stock alerts
// const lowStockProducts$ = queryDb(
//   tables.products
//     .select()
//     .where({ isActive: true })
//     .having(tables.products.column('stock').minus(tables.products.column('reservedStock')).lt(10))
//     .orderBy('stock'),
//   { label: 'lowStockProducts' }
// )`
