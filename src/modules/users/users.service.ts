import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "./entities/user.entity.js";
import { Repository } from "typeorm";

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private readonly usesReposity: Repository<User>,
    ) { }

    //Tìm người dung theo so dien thoai
    async findByPhoneNumber(phoneNumber: string): Promise<User | null> {
        return this.usesReposity.findOne({
            where: {
                phoneNumber
            }
        });
    }

    //Tìm người dung theo id
    async findById(userId: string): Promise<User | null> {
        return this.usesReposity.findOne({
            where: {
                userId
            }
        })
    }
    //Tăng token trong DB, nếu token ở DB khác với ở jwt thị bị logout
    async incrementTokenVersion(userId: string): Promise<void> {
        const result = await this.usesReposity.increment(
            { userId },
            'tokenVersion',
            1
        );
        if (result.affected === 0) {
            throw new NotFoundException('Không tìm thấy người dùng!');
        }
    }

    //Đổi mật khẩu
    async upatePassword(userId: string, passwordHash: string): Promise<void> {
        const result = await this.usesReposity.update(
            { userId },
            { passwordHash }
        )
        if (result.affected === 0) {
            throw new NotFoundException('Không tìm thấy người dùng!');
        }
    }

    //Tạo người dùng mới
    async createUser(userData: Partial<User>): Promise<User> {
        const newUser = this.usesReposity.create(userData);
        return this.usesReposity.save(newUser);
    }
}