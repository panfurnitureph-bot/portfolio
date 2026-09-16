/* Separate in-browser database for the Northwind Motor Parts demo (own localStorage key, own seed version). */
import { DemoDb } from '../../pan/db/store'

export const procureDb = new DemoDb('procure-demo-db-v1')
