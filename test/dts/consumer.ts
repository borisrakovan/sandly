import { Container, Layer, ScopedContainer, Tag } from 'sandly';

class Database {}

class UserService {
	constructor(readonly db: Database) {}
}

const Port = Tag.of('Port')<number>();

export const root = Container.from(
	Layer.service(UserService, [Database])
		.provide(Layer.service(Database, []))
		.merge(Layer.values([Port, 3000]))
);

export async function handleRequest(
	app: ScopedContainer<typeof Database>
): Promise<UserService> {
	await using request = app.childFrom(
		'request',
		Layer.service(UserService, [Database])
	);
	return request.resolve(UserService);
}
