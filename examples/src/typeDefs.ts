import { gql } from 'apollo-server-express';

export const typeDefs = gql`
type Query {
  hello: String!
}

type Subscription {
  configChanged(userId: ID!): ConfigUpdate
}

type ConfigUpdate {
  Update: String
  userId: ID
}

schema {
  query: Query
  subscription: Subscription
}`;

